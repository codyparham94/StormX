/**
 * The outage history panel in Outage risk mode: pick a past event or a date, then replay each
 * county's daily peak outages from EAGLE-I, day by day.
 */
import Graphic from "@arcgis/core/Graphic.js";
import type Extent from "@arcgis/core/geometry/Extent.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import ClassBreaksRenderer from "@arcgis/core/renderers/ClassBreaksRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import {
  FIRST_DAY,
  LAST_DAY,
  dayLabel,
  dayStatus,
  daysBetween,
  eventLabel,
  focusCounties,
  monthsFor,
  nationalTotals,
  peaksForWindow,
  replayCounties,
  windowFrom,
  type CountyFeature,
  type MonthFile,
  type OutageEvent,
} from "./history-format";

export interface ReplayHost {
  /** Shows the replay layer over the outage map, hiding today's outages and weather, and zooms to
   * `focus`; null removes it and brings the live layers back. */
  showReplay(layer: FeatureLayer | null, focus?: Extent): void;
}

const STEP_MS = 1200;

function percentRenderer(day: number): ClassBreaksRenderer {
  const fill = (color: number[]) => new SimpleFillSymbol({ color: [...color, 0.75], outline: { color: [255, 255, 255, 0.7], width: 0.4 } });
  return new ClassBreaksRenderer({
    valueExpression: `var c = $feature.customers; if (IsEmpty(c) || c == 0) { return null; } return 100 * $feature.d${day} / c;`,
    valueExpressionTitle: "Customers out (% of county)",
    // Under 1% is everyday background, so those counties stay clear.
    classBreakInfos: [
      { minValue: 1, maxValue: 5, label: "1% to 5%", symbol: fill([253, 204, 138]) },
      { minValue: 5, maxValue: 15, label: "5% to 15%", symbol: fill([252, 141, 89]) },
      { minValue: 15, maxValue: 35, label: "15% to 35%", symbol: fill([227, 74, 51]) },
      { minValue: 35, maxValue: 60, label: "35% to 60%", symbol: fill([179, 0, 0]) },
      { minValue: 60, maxValue: 100_000, label: "60% or more", symbol: fill([110, 0, 30]) },
    ],
  });
}

function dayPopup(day: number, label: string) {
  return {
    title: "{name}, {state}",
    content: [
      {
        type: "fields" as const,
        fieldInfos: [
          { fieldName: `d${day}`, label: `Most customers out at once, ${label}`, format: { digitSeparator: true, places: 0 } },
          { fieldName: "customers", label: "Customers in the county (modeled)", format: { digitSeparator: true, places: 0 } },
        ],
      },
      { type: "text" as const, text: "Real data from ORNL EAGLE-I, scraped from utility outage maps every 15 minutes. Days are UTC." },
    ],
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
}

export function setUpHistoryPanel(dataBaseUrl: string, host: () => Promise<ReplayHost>): void {
  const panel = document.getElementById("history-panel");
  const picker = document.getElementById("history-event") as HTMLSelectElement | null;
  const dateForm = document.getElementById("history-date-form") as HTMLFormElement | null;
  const dateInput = document.getElementById("history-date") as HTMLInputElement | null;
  const controls = document.getElementById("history-controls");
  const play = document.getElementById("history-play") as (HTMLElement & { iconStart: string }) | null;
  const slider = document.getElementById("history-day") as HTMLInputElement | null;
  const status = document.getElementById("history-status");
  const stop = document.getElementById("history-stop");
  const message = document.getElementById("history-message");
  if (!panel || !picker || !dateForm || !dateInput || !controls || !play || !slider || !status || !stop || !message) return;
  if (!dataBaseUrl) {
    message.textContent = "Outage history needs the data service, which this build doesn't have.";
    return;
  }
  const base = `${dataBaseUrl}/history/outages`;
  dateInput.min = FIRST_DAY;
  dateInput.max = LAST_DAY;

  let counties: Promise<CountyFeature[]> | undefined;
  const monthCache = new Map<string, Promise<MonthFile | undefined>>();
  const month = (m: string) => {
    if (!monthCache.has(m)) monthCache.set(m, getJson<MonthFile>(`${base}/daily/${m}.json`).catch(() => undefined));
    return monthCache.get(m)!;
  };

  let layer: FeatureLayer | null = null;
  let days: string[] = [];
  let totals: number[] = [];
  let timer = 0;

  const showDay = (i: number) => {
    if (!layer) return;
    slider.value = String(i);
    layer.renderer = percentRenderer(i);
    layer.popupTemplate = dayPopup(i, dayLabel(days[i]));
    status.textContent = dayStatus(days[i], totals[i]);
  };
  const pause = () => {
    window.clearInterval(timer);
    timer = 0;
    play.iconStart = "play";
    play.textContent = "Play";
  };
  const clear = async () => {
    pause();
    (await host()).showReplay(null);
    layer = null;
    controls.hidden = true;
    message.textContent = "";
  };

  const replay = async (window_: string[], title: string) => {
    await clear();
    message.textContent = "Loading outage history…";
    try {
      counties ??= getJson<{ features: CountyFeature[] }>(`${base}/counties.geojson`).then((c) => c.features);
      const months = (await Promise.all(monthsFor(window_).map(month))).filter((m): m is MonthFile => !!m);
      const peaks = peaksForWindow(window_, months);
      if (!peaks.size) {
        message.textContent = "No outages on record for those days.";
        return;
      }
      days = window_;
      totals = nationalTotals(days, months);
      // Built in memory: the site's content security policy keeps blob: URLs out of fetch.
      const source = replayCounties(await counties, peaks).map(
        ({ rings, attributes }) => new Graphic({ geometry: new Polygon({ rings, spatialReference: { wkid: 4326 } }), attributes }),
      );
      layer = new FeatureLayer({
        source,
        title,
        useViewTime: false,
        copyright: "ORNL EAGLE-I",
        geometryType: "polygon",
        spatialReference: { wkid: 4326 },
        objectIdField: "oid",
        fields: [
          { name: "oid", type: "oid" },
          { name: "fips", type: "string" },
          { name: "name", type: "string" },
          { name: "state", type: "string" },
          { name: "customers", type: "integer" },
          ...days.map((_, i) => ({ name: `d${i}`, type: "integer" as const })),
        ],
      });
      // Start on the worst day, which is what the visitor usually wants to see first, and frame the
      // hardest-hit counties that together had 80% of that day's outages, leaving out stray far-off ones.
      const worst = totals.indexOf(Math.max(...totals));
      slider.max = String(days.length - 1);
      showDay(worst);
      const extents = source.map((g) => g.geometry?.extent);
      const hit = focusCounties(
        source.map((g, i) => ({ out: Number(g.attributes[`d${worst}`]) || 0, center: extents[i] ? [extents[i].center.x, extents[i].center.y] : [0, 0] })),
      );
      const focus = hit.map((i) => extents[i]).reduce<Extent | undefined>((all, e) => (e ? (all ? all.union(e) : e.clone()) : all), undefined);
      (await host()).showReplay(layer, focus);
      controls.hidden = false;
      message.textContent = "";
    } catch (error) {
      console.error(error);
      message.textContent = "Outage history couldn't load. Try again in a moment.";
    }
  };

  void getJson<{ events: OutageEvent[] }>(`${base}/events.json`)
    .then(({ events }) => {
      for (const event of [...events].reverse()) {
        const option = document.createElement("option");
        option.value = `${event.start}/${event.end}`;
        option.textContent = eventLabel(event);
        picker.append(option);
      }
    })
    .catch(() => (message.textContent = "The list of past events couldn't load."));

  picker.addEventListener("change", () => {
    if (!picker.value) return;
    const [start, end] = picker.value.split("/");
    void replay(daysBetween(start, end), `Outage replay: ${picker.selectedOptions[0]?.textContent ?? ""}`);
  });
  dateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dateInput.value) return;
    picker.value = "";
    const window_ = windowFrom(dateInput.value);
    void replay(window_, `Outage replay from ${dayLabel(window_[0])}`);
  });
  slider.addEventListener("input", () => {
    pause();
    showDay(Number(slider.value));
  });
  play.addEventListener("click", () => {
    if (timer) return pause();
    play.iconStart = "pause";
    play.textContent = "Pause";
    timer = window.setInterval(() => showDay((Number(slider.value) + 1) % days.length), STEP_MS);
  });
  stop.addEventListener("click", () => {
    picker.value = "";
    void clear();
  });
}
