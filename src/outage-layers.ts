/**
 * Outage risk mode's layers, all Real so far. The grid is drawn live from Esri-hosted copies of
 * HIFLD; current outages come from the ODIN ETL through the data Worker.
 */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import GroupLayer from "@arcgis/core/layers/GroupLayer.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import ClassBreaksRenderer from "@arcgis/core/renderers/ClassBreaksRenderer.js";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol.js";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";
import { alertsLayer, fireIncidentsLayer, firePerimetersLayer, mrmsLayer } from "./radar-layers";

const LINES_URL = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0";
const SUBSTATIONS_URL = "https://services6.arcgis.com/OO2s4OoyCZkYJ6oE/arcgis/rest/services/Substations/FeatureServer/0";

// Only the radar follows the time slider (hidden in this mode, but it still sets the view's time).
const untimed = { useViewTime: false } as const;

export interface OutageLayers {
  layers: Layer[];
  /** Today's outages and weather, and the grid that would bury the fills, hidden during a replay. */
  live: Layer[];
}

export function createOutageLayers(dataBaseUrl: string): OutageLayers {
  const weather = new GroupLayer({
    title: "Weather now",
    visibilityMode: "independent",
    layers: [
      mrmsLayer(),
      alertsLayer("NWS watches, warnings and advisories"),
      firePerimetersLayer(),
      Object.assign(fireIncidentsLayer(), { visible: false }),
    ],
  });

  const layers: Layer[] = [weather];
  let current: GeoJSONLayer | undefined;
  if (dataBaseUrl) {
    current = outagesLayer(dataBaseUrl);
    layers.push(historyLayer(dataBaseUrl), current);
  }
  const grid = gridGroup(dataBaseUrl);
  layers.push(grid);
  // Bottom to top: weather, the history heatmap, current outages, then the grid so lines stay
  // readable over the fills.
  return { layers, live: current ? [weather, current, grid] : [weather, grid] };
}

function historyLayer(dataBaseUrl: string): GeoJSONLayer {
  const fill = (color: number[]) => new SimpleFillSymbol({ color: [...color, 0.65], outline: { color: [255, 255, 255, 0.5], width: 0.3 } });
  return new GeoJSONLayer({
    ...untimed,
    url: `${dataBaseUrl}/history/outages/counties.geojson`,
    title: "Outage history heatmap (EAGLE-I, 2015 to 2025)",
    copyright: "ORNL EAGLE-I",
    visible: false,
    opacity: 0.85,
    geometryType: "polygon",
    fields: [
      { name: "fips", type: "string" },
      { name: "name", type: "string" },
      { name: "state", type: "string" },
      { name: "customers", type: "integer" },
      { name: "hours_per_customer", type: "double" },
      { name: "outage_days", type: "double" },
      { name: "worst", type: "integer" },
      { name: "worst_day", type: "string" },
      { name: "worst_pct", type: "double" },
    ],
    renderer: new ClassBreaksRenderer({
      field: "hours_per_customer",
      legendOptions: { title: "Hours without power per customer per year" },
      defaultLabel: "No data",
      defaultSymbol: fill([200, 200, 200]),
      classBreakInfos: [
        { minValue: 0, maxValue: 2, label: "Under 2 hours", symbol: fill([237, 248, 251]) },
        { minValue: 2, maxValue: 5, label: "2 to 5 hours", symbol: fill([179, 205, 227]) },
        { minValue: 5, maxValue: 10, label: "5 to 10 hours", symbol: fill([140, 150, 198]) },
        { minValue: 10, maxValue: 24, label: "10 to 24 hours", symbol: fill([136, 86, 167]) },
        { minValue: 24, maxValue: 100_000, label: "A day or more", symbol: fill([129, 15, 124]) },
      ],
    }),
    popupTemplate: {
      title: "{name}, {state}: outage history",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "hours_per_customer", label: "Hours without power per customer, yearly average", format: { places: 1 } },
            { fieldName: "outage_days", label: "Outage days per year (1% or more of customers out)", format: { places: 1 } },
            { fieldName: "worst", label: "Most customers out at once", format: { digitSeparator: true, places: 0 } },
            { fieldName: "worst_pct", label: "As a share of customers (%)", format: { places: 1 } },
            { fieldName: "worst_day", label: "On (UTC)" },
            { fieldName: "customers", label: "Customers (modeled)", format: { digitSeparator: true, places: 0 } },
          ],
        },
        {
          type: "text",
          text: "Real data from ORNL EAGLE-I, 2015 to 2025. Coverage grew over the years and gaps in collection count as no outage, so these are lower bounds.",
        },
      ],
    },
  });
}

function outagesLayer(dataBaseUrl: string): GeoJSONLayer {
  const fill = (color: number[]) => new SimpleFillSymbol({ color: [...color, 0.7], outline: { color: [255, 255, 255, 0.8], width: 0.6 } });
  return new GeoJSONLayer({
    ...untimed,
    url: `${dataBaseUrl}/live/outages/odin-county.geojson`,
    title: "Customers out by county (ORNL ODIN)",
    copyright: "ORNL ODIN, reported by participating utilities",
    // The ETL runs every 15 minutes.
    refreshInterval: 5,
    geometryType: "polygon",
    fields: [
      { name: "fips", type: "string" },
      { name: "county", type: "string" },
      { name: "state", type: "string" },
      { name: "customers_out", type: "integer" },
      { name: "utilities", type: "string" },
    ],
    renderer: new ClassBreaksRenderer({
      field: "customers_out",
      legendOptions: { title: "Customers out" },
      classBreakInfos: [
        { minValue: 1, maxValue: 99, label: "1 to 99", symbol: fill([254, 217, 118]) },
        { minValue: 100, maxValue: 999, label: "100 to 999", symbol: fill([253, 141, 60]) },
        { minValue: 1_000, maxValue: 9_999, label: "1,000 to 9,999", symbol: fill([240, 59, 32]) },
        { minValue: 10_000, maxValue: 49_999, label: "10,000 to 49,999", symbol: fill([189, 0, 38]) },
        { minValue: 50_000, maxValue: Number.MAX_SAFE_INTEGER, label: "50,000 or more", symbol: fill([110, 1, 60]) },
      ],
    }),
    popupTemplate: {
      title: "{county}, {state}",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "customers_out", label: "Customers out", format: { digitSeparator: true, places: 0 } },
            { fieldName: "utilities", label: "Reported by" },
          ],
        },
        {
          type: "text",
          text: "Real data from ORNL ODIN, updated every 15 minutes. Only utilities that report to ODIN are counted, so a county with no color may still have outages.",
        },
      ],
    },
  });
}

function gridGroup(dataBaseUrl: string): GroupLayer {
  const substations = substationsLayer();
  const grid = new GroupLayer({
    title: "Power grid (HIFLD)",
    visibilityMode: "independent",
    layers: [
      // The 94,000 lines are a solid mat at regional zooms, so the smaller ones wait until about zoom 8.
      linesLayer("Transmission lines under 220 kV", "VOLT_CLASS NOT IN ('220-287', '345', '500', '735 AND ABOVE', 'DC')", 3_000_000),
      linesLayer("Transmission lines, 220 kV and above", "VOLT_CLASS IN ('220-287', '345', '500', '735 AND ABOVE', 'DC')", 20_000_000),
      substations,
    ],
  });
  // The live substations are a personal re-upload that could vanish; fall back to the R2 snapshot.
  if (dataBaseUrl)
    substations.load().catch(() => {
      const index = grid.layers.indexOf(substations);
      grid.layers.remove(substations);
      grid.layers.add(substationsSnapshot(dataBaseUrl), index);
    });
  return grid;
}

function line(color: number[], width: number, style: "solid" | "dash" = "solid") {
  return new SimpleLineSymbol({ color, width, style });
}

function linesLayer(title: string, definitionExpression: string, minScale: number): FeatureLayer {
  return new FeatureLayer({
    ...untimed,
    url: LINES_URL,
    title,
    definitionExpression,
    copyright: "HIFLD via USFWS",
    minScale,
    outFields: ["OWNER", "VOLTAGE", "VOLT_CLASS", "TYPE", "STATUS", "SUB_1", "SUB_2"],
    renderer: new UniqueValueRenderer({
      field: "VOLT_CLASS",
      legendOptions: { title: "Voltage" },
      defaultLabel: "Unknown voltage",
      defaultSymbol: line([150, 150, 150, 0.8], 0.6),
      uniqueValueInfos: [
        { value: "735 AND ABOVE", label: "735 kV and above", symbol: line([84, 39, 143], 3) },
        { value: "500", label: "500 kV", symbol: line([117, 107, 177], 2.5) },
        { value: "345", label: "345 kV", symbol: line([33, 113, 181], 2) },
        { value: "220-287", label: "220 to 287 kV", symbol: line([66, 146, 198], 1.6) },
        { value: "100-161", label: "100 to 161 kV", symbol: line([35, 139, 69], 1.2) },
        { value: "UNDER 100", label: "Under 100 kV", symbol: line([116, 196, 118], 0.9) },
        { value: "SUB 100", label: "Under 100 kV", symbol: line([116, 196, 118], 0.9) },
        { value: "DC", label: "DC", symbol: line([230, 85, 13], 2, "dash") },
      ],
    }),
    popupTemplate: {
      title: "Transmission line",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "OWNER", label: "Owner" },
            { fieldName: "VOLT_CLASS", label: "Voltage class (kV)" },
            { fieldName: "VOLTAGE", label: "Voltage (kV)" },
            { fieldName: "TYPE", label: "Type" },
            { fieldName: "STATUS", label: "Status" },
            { fieldName: "SUB_1", label: "From substation" },
            { fieldName: "SUB_2", label: "To substation" },
          ],
        },
      ],
    },
  });
}

const SUBSTATION_FIELDS = ["NAME", "CITY", "STATE", "COUNTY", "STATUS", "LINES", "MAX_VOLT", "MIN_VOLT"];

const substationOptions = {
  ...untimed,
  title: "Substations",
  copyright: "HIFLD",
  // About zoom 8: 78,000 points nationally.
  minScale: 2_500_000,
  renderer: new SimpleRenderer({
    label: "Substation",
    symbol: new SimpleMarkerSymbol({ style: "square", size: 5, color: [255, 255, 255, 0.95], outline: { color: [60, 60, 60, 1], width: 1.2 } }),
  }),
  popupTemplate: {
    title: "{NAME}",
    content: [
      {
        type: "fields" as const,
        fieldInfos: [
          { fieldName: "CITY", label: "City" },
          { fieldName: "STATE", label: "State" },
          { fieldName: "MAX_VOLT", label: "Highest voltage (kV)" },
          { fieldName: "MIN_VOLT", label: "Lowest voltage (kV)" },
          { fieldName: "LINES", label: "Lines" },
          { fieldName: "STATUS", label: "Status" },
        ],
      },
    ],
  },
};

function substationsLayer(): FeatureLayer {
  return new FeatureLayer({ ...substationOptions, url: SUBSTATIONS_URL, outFields: SUBSTATION_FIELDS });
}

function substationsSnapshot(dataBaseUrl: string): GeoJSONLayer {
  const numeric = new Set(["LINES", "MAX_VOLT", "MIN_VOLT"]);
  return new GeoJSONLayer({
    ...substationOptions,
    url: `${dataBaseUrl}/grid/substations.geojson`,
    geometryType: "point",
    fields: SUBSTATION_FIELDS.map((name) => ({ name, type: numeric.has(name) ? ("integer" as const) : ("string" as const) })),
  });
}
