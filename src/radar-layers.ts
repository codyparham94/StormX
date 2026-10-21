/**
 * Radar mode's layers, all public and all Real. NOAA and NIFC services are drawn live from their
 * own servers; FIRMS hotspots and HMS smoke come from the ETL through the data Worker.
 */
import FeatureLayer, { type FeatureLayerProperties } from "@arcgis/core/layers/FeatureLayer.js";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import GroupLayer from "@arcgis/core/layers/GroupLayer.js";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer.js";
import MapImageLayer from "@arcgis/core/layers/MapImageLayer.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import type { FieldsContentProperties } from "@arcgis/core/popup/content/FieldsContent.js";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";

export const MRMS_URL = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer";
const NWS_WWA_URL = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/FeatureServer/1";
const SPC_URL = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/FeatureServer";
const SPC_FIRE_URL = "https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/SPC_firewx/MapServer";
const WSSI_URL = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer";
const HURRICANES_URL = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer";
const WILDFIRES_URL = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer";

/** Fire weather products in the NWS layer; the Alerts layer leaves them to the Fire group. */
export const FIRE_WEATHER_EVENTS = ["Red Flag Warning", "Fire Weather Watch"];
const fireWeatherSql = `prod_type IN (${FIRE_WEATHER_EVENTS.map((e) => `'${e}'`).join(", ")})`;

// Feeds that aren't the radar must ignore the time slider, which only drives the radar loop.
const untimed = { useViewTime: false } as const;

function alertPopup() {
  return {
    title: "{prod_type}",
    content: [
      {
        type: "fields" as const,
        fieldInfos: [
          { fieldName: "issuance", label: "Issued", format: { dateFormat: "short-date-short-time" as const } },
          { fieldName: "expiration", label: "Expires", format: { dateFormat: "short-date-short-time" as const } },
          { fieldName: "wfo", label: "NWS office" },
        ],
      },
      { type: "text" as const, text: '<a href="{url}" target="_blank" rel="noopener">Full alert text from NWS</a>' },
    ],
  };
}

export interface RadarLayers {
  radar: ImageryLayer;
  groups: Layer[];
}

export function createRadarLayers(dataBaseUrl: string): RadarLayers {
  const radar = new ImageryLayer({
    url: MRMS_URL,
    title: "Radar (NOAA MRMS base reflectivity)",
    opacity: 0.75,
    format: "png",
    popupEnabled: false,
    // New scans arrive about every 5 minutes; radar-loop.ts moves the slider along with them.
    refreshInterval: 5,
  });

  const alerts = new FeatureLayer({
    ...untimed,
    url: NWS_WWA_URL,
    title: "NWS watches, warnings and advisories",
    definitionExpression: `NOT (${fireWeatherSql})`,
    opacity: 0.6,
    outFields: ["*"],
    popupTemplate: alertPopup(),
    refreshInterval: 2,
  });

  const outlookPopup = { title: "SPC outlook: {label2}", content: "Valid {valid} to {expire} (UTC)." };
  const spc = (id: number, title: string, visible: boolean) =>
    new FeatureLayer({ ...untimed, url: `${SPC_URL}/${id}`, title, visible, opacity: 0.45, outFields: ["*"], popupTemplate: outlookPopup });
  const outlooks = new GroupLayer({
    title: "Severe weather outlooks (SPC)",
    visibilityMode: "independent",
    layers: [
      new MapImageLayer({ ...untimed, url: WSSI_URL, title: "Winter storm severity, days 1 to 3 (WPC)", visible: false, opacity: 0.55, sublayers: [{ id: 4, visible: true }] }),
      spc(7, "Day 1 wind probability", false),
      spc(5, "Day 1 hail probability", false),
      spc(3, "Day 1 tornado probability", false),
      spc(1, "Day 1 categorical outlook", true),
    ],
  });

  const stormPopup = {
    title: "{STORMTYPE} {STORMNAME}",
    content: [
      {
        type: "fields" as const,
        fieldInfos: [
          { fieldName: "DATELBL", label: "Forecast time" },
          { fieldName: "MAXWIND", label: "Max wind (kt)" },
          { fieldName: "GUST", label: "Gusts (kt)" },
          { fieldName: "MSLP", label: "Pressure (mb)" },
          { fieldName: "ADVISNUM", label: "Advisory" },
        ],
      },
    ],
  };
  const hurricane = (id: number, title: string, extra: Partial<FeatureLayerProperties> = {}) =>
    new FeatureLayer({ ...untimed, url: `${HURRICANES_URL}/${id}`, title, outFields: ["*"], popupEnabled: false, refreshInterval: 15, ...extra });
  const tropical = new GroupLayer({
    title: "Tropical storms (NHC)",
    visibilityMode: "independent",
    layers: [
      hurricane(4, "Forecast cone", { opacity: 0.5 }),
      hurricane(5, "Coastal watches and warnings"),
      hurricane(3, "Observed track"),
      hurricane(2, "Forecast track"),
      hurricane(0, "Forecast positions", { popupEnabled: true, popupTemplate: stormPopup }),
    ],
  });

  const fireGroupLayers: Layer[] = [
    new MapImageLayer({ ...untimed, url: SPC_FIRE_URL, title: "Fire weather outlook, day 1 (SPC)", visible: false, opacity: 0.5, sublayers: [{ id: 0, visible: true }] }),
    new FeatureLayer({
      ...untimed,
      url: NWS_WWA_URL,
      title: "Red flag warnings and fire weather watches",
      definitionExpression: fireWeatherSql,
      opacity: 0.6,
      outFields: ["*"],
      popupTemplate: alertPopup(),
      refreshInterval: 5,
    }),
  ];
  if (dataBaseUrl) {
    fireGroupLayers.push(
      new GeoJSONLayer({
        ...untimed,
        url: `${dataBaseUrl}/live/fire/smoke.geojson`,
        title: "Smoke plumes (NOAA HMS)",
        visible: false,
        copyright: "NOAA Hazard Mapping System",
        renderer: smokeRenderer(),
        popupTemplate: { title: "{density} smoke", content: "Analyzed from {satellite} imagery, {start} to {end} (UTC)." },
      }),
      new GeoJSONLayer({
        ...untimed,
        url: `${dataBaseUrl}/live/fire/firms.geojson`,
        title: "Satellite hotspots, last 24 hours (NASA FIRMS)",
        visible: false,
        copyright: "NASA FIRMS",
        renderer: hotspotRenderer(),
        popupTemplate: {
          title: "Hotspot ({confidence} confidence)",
          content: "Seen by {source} at {acquired} (UTC), {daynight}. Fire radiative power: {frp} MW.",
        },
      }),
    );
  }
  fireGroupLayers.push(
    new FeatureLayer({
      ...untimed,
      url: `${WILDFIRES_URL}/1`,
      title: "Fire perimeters (NIFC)",
      outFields: ["*"],
      popupTemplate: firePopup("Perimeter: {IncidentName}", [
        { fieldName: "GISAcres", label: "Acres", format: { digitSeparator: true, places: 0 } },
        { fieldName: "DateCurrent", label: "Last updated", format: { dateFormat: "short-date-short-time" } },
      ]),
    }),
    new FeatureLayer({
      ...untimed,
      url: `${WILDFIRES_URL}/0`,
      title: "Active fire incidents (NIFC)",
      // Hundreds of icons bury the national view; the perimeters carry it until zoom 6.
      minScale: 9_500_000,
      outFields: ["*"],
      popupTemplate: firePopup("{IncidentName} Fire", [
        { fieldName: "DailyAcres", label: "Size (acres)", format: { digitSeparator: true, places: 0 } },
        { fieldName: "PercentContained", label: "Contained (%)" },
        { fieldName: "FireDiscoveryDateTime", label: "Started", format: { dateFormat: "short-date" } },
        { fieldName: "ModifiedOnDateTime", label: "Last updated", format: { dateFormat: "short-date-short-time" } },
        { fieldName: "POOCounty", label: "County" },
        { fieldName: "POOState", label: "State" },
      ]),
    }),
  );
  const fire = new GroupLayer({ title: "Fire", visibilityMode: "independent", layers: fireGroupLayers });

  // Bottom to top: outlooks under the radar, alerts and storms over it, fire on top.
  return { radar, groups: [outlooks, radar, alerts, tropical, fire] };
}

function firePopup(title: string, fieldInfos: NonNullable<FieldsContentProperties["fieldInfos"]>) {
  return { title, content: [{ type: "fields" as const, fieldInfos }] };
}

function smokeRenderer(): UniqueValueRenderer {
  const fill = (alpha: number) => new SimpleFillSymbol({ color: [120, 120, 120, alpha], outline: { color: [90, 90, 90, 0.6], width: 0.5 } });
  return new UniqueValueRenderer({
    field: "density",
    defaultSymbol: fill(0.2),
    uniqueValueInfos: [
      { value: "Light", label: "Light smoke", symbol: fill(0.18) },
      { value: "Medium", label: "Medium smoke", symbol: fill(0.32) },
      { value: "Heavy", label: "Heavy smoke", symbol: fill(0.5) },
    ],
  });
}

function hotspotRenderer(): SimpleRenderer {
  return new SimpleRenderer({
    label: "Satellite hotspot",
    symbol: new SimpleMarkerSymbol({ size: 5, color: [255, 87, 34, 0.9], outline: { color: [120, 30, 0, 0.8], width: 0.5 } }),
  });
}
