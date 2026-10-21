/**
 * The forecast popup: a ZIP code or "Use my location" gives current conditions, the next 24 hours,
 * 7 days and active alerts from the NWS API (free, no key, CORS open). ZIPs become coordinates
 * through the ZCTA centroids the ETL publishes on R2, so there is no geocoding service or key.
 */
import { DATA_BASE_URL } from "./config";
import { ago, celsiusToF, hourLabel, kmhToMph, parseZip, pointsPath, sortAlerts } from "./forecast-format";

const NWS = "https://api.weather.gov";

interface Period {
  name: string;
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  windSpeed: string;
  windDirection: string;
  probabilityOfPrecipitation?: { value: number | null };
}

interface Alert {
  event: string;
  headline?: string;
  severity?: string;
  ends?: string | null;
  expires?: string | null;
}

export interface Place {
  lat: number;
  lon: number;
  label: string;
}

let zctaCache: Promise<Record<string, [number, number]>> | undefined;

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/geo+json" } });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return response.json() as Promise<T>;
}

export async function zipToPlace(zip: string): Promise<Place> {
  if (!DATA_BASE_URL) throw new Error("ZIP lookup isn't set up in this build. Try “Use my location”.");
  zctaCache ??= json<Record<string, [number, number]>>(`${DATA_BASE_URL}/static/zcta.json`).catch((err) => {
    zctaCache = undefined;
    throw err;
  });
  const hit = (await zctaCache)[zip];
  if (!hit) throw new Error(`ZIP ${zip} wasn't found.`);
  return { lat: hit[0], lon: hit[1], label: `ZIP ${zip}` };
}

export function myLocation(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Your location" }),
      () => reject(new Error("Location permission was denied.")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  });
}

interface Forecast {
  place: string;
  timeZone?: string;
  current?: { text: string; tempF: number | null; windMph: number | null; humidity: number | null; observed: Date; station: string };
  hourly: Period[];
  daily: Period[];
  alerts: Alert[];
}

export async function loadForecast(place: Place): Promise<Forecast> {
  type Points = {
    properties: {
      forecast: string;
      forecastHourly: string;
      observationStations: string;
      timeZone?: string;
      relativeLocation?: { properties: { city: string; state: string } };
    };
  };
  let points: Points;
  try {
    points = await json<Points>(`${NWS}${pointsPath(place.lat, place.lon)}`);
  } catch {
    throw new Error("NWS has no forecast for this spot. Forecasts cover the U.S. and its territories.");
  }
  const p = points.properties;
  const where = p.relativeLocation ? `${p.relativeLocation.properties.city}, ${p.relativeLocation.properties.state}` : place.label;

  const [daily, hourly, alerts, current] = await Promise.all([
    json<{ properties: { periods: Period[] } }>(p.forecast).then((r) => r.properties.periods).catch(() => [] as Period[]),
    json<{ properties: { periods: Period[] } }>(p.forecastHourly).then((r) => r.properties.periods.slice(0, 24)).catch(() => [] as Period[]),
    json<{ features: { properties: Alert }[] }>(`${NWS}/alerts/active?point=${place.lat.toFixed(4)},${place.lon.toFixed(4)}`)
      .then((r) => sortAlerts(r.features.map((f) => f.properties)))
      .catch(() => [] as Alert[]),
    latestObservation(p.observationStations).catch(() => undefined),
  ]);
  return { place: place.label === "Your location" ? where : `${where} (${place.label})`, timeZone: p.timeZone, current, hourly, daily, alerts };
}

async function latestObservation(stationsUrl: string): Promise<Forecast["current"]> {
  const stations = await json<{ features: { properties: { stationIdentifier: string; name: string } }[] }>(stationsUrl);
  const station = stations.features[0]?.properties;
  if (!station) return undefined;
  type Obs = {
    properties: {
      textDescription: string;
      timestamp: string;
      temperature: { value: number | null };
      windSpeed: { value: number | null };
      relativeHumidity: { value: number | null };
    };
  };
  const obs = (await json<Obs>(`${NWS}/stations/${station.stationIdentifier}/observations/latest`)).properties;
  return {
    text: obs.textDescription || "Conditions not reported",
    tempF: celsiusToF(obs.temperature.value),
    windMph: kmhToMph(obs.windSpeed.value),
    humidity: obs.relativeHumidity.value === null ? null : Math.round(obs.relativeHumidity.value),
    observed: new Date(obs.timestamp),
    station: station.name,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderForecast(target: HTMLElement, f: Forecast): void {
  target.replaceChildren();
  target.append(el("h3", "fc-place", f.place));

  if (f.alerts.length) {
    const list = el("ul", "fc-alerts");
    for (const a of f.alerts) {
      const item = el("li", `fc-alert sev-${(a.severity ?? "unknown").toLowerCase()}`);
      item.append(el("strong", undefined, a.event));
      if (a.headline) item.append(el("span", undefined, a.headline));
      list.append(item);
    }
    target.append(list);
  }

  if (f.current) {
    const now = el("div", "fc-now");
    now.append(el("span", "fc-temp", f.current.tempF === null ? "--" : `${f.current.tempF}°`));
    const detail = el("div");
    detail.append(el("strong", undefined, f.current.text));
    const bits = [
      f.current.windMph !== null ? `Wind ${f.current.windMph} mph` : "",
      f.current.humidity !== null ? `Humidity ${f.current.humidity}%` : "",
    ].filter(Boolean);
    if (bits.length) detail.append(el("span", undefined, bits.join(" · ")));
    detail.append(el("small", undefined, `${f.current.station}, ${ago(f.current.observed)}`));
    now.append(detail);
    target.append(now);
  }

  if (f.hourly.length) {
    target.append(el("h4", undefined, "Next 24 hours"));
    const strip = el("ol", "fc-hours");
    for (const h of f.hourly) {
      const cell = el("li");
      cell.title = h.shortForecast;
      cell.append(el("span", "fc-h", hourLabel(h.startTime, f.timeZone)), el("strong", undefined, `${h.temperature}°`));
      const pop = h.probabilityOfPrecipitation?.value;
      cell.append(el("small", undefined, pop ? `${pop}%` : ""));
      strip.append(cell);
    }
    target.append(strip);
  }

  if (f.daily.length) {
    target.append(el("h4", undefined, "7 days"));
    const days = el("ul", "fc-days");
    for (const d of f.daily) {
      const row = el("li", d.isDaytime ? "day" : "night");
      row.append(el("span", "fc-d", d.name), el("span", "fc-short", d.shortForecast), el("strong", undefined, `${d.temperature}°${d.temperatureUnit}`));
      days.append(row);
    }
    target.append(days);
  }
  target.append(el("p", "fc-credit", "Forecast and alerts: National Weather Service"));
}

/** Wires the panel's form; `onPlace` lets the map mark and zoom to the place. */
export function setUpForecastPanel(onPlace: (place: Place) => void): void {
  const form = document.getElementById("forecast-form") as HTMLFormElement | null;
  const input = document.getElementById("forecast-zip") as (HTMLElement & { value: string }) | null;
  const locate = document.getElementById("forecast-locate");
  const out = document.getElementById("forecast-result");
  if (!form || !input || !locate || !out) return;

  const show = async (find: () => Promise<Place>) => {
    out.replaceChildren(el("calcite-loader", undefined) as HTMLElement);
    out.firstElementChild?.setAttribute("label", "Loading the forecast");
    out.firstElementChild?.setAttribute("scale", "s");
    try {
      const place = await find();
      onPlace(place);
      renderForecast(out, await loadForecast(place));
    } catch (err) {
      out.replaceChildren(el("p", "fc-error", err instanceof Error ? err.message : "The forecast couldn't load."));
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const zip = parseZip(input.value ?? "");
    if (!zip) {
      out.replaceChildren(el("p", "fc-error", "Enter a 5-digit ZIP code."));
      return;
    }
    void show(() => zipToPlace(zip));
  });
  locate.addEventListener("click", () => void show(myLocation));
}
