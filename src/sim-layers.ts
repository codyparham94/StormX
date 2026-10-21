/**
 * StormX Demo Electric, the fictional utility in the Gulf Coast demo region, from the sim ETL.
 * Every layer is hatched or dashed and says Simulated, so a screenshot can't pass it off as a real
 * utility.
 */
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import GroupLayer from "@arcgis/core/layers/GroupLayer.js";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol.js";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";
import { SIM_NOTE } from "./sim-format";

const simOptions = { useViewTime: false, copyright: "Simulated by StormX", refreshInterval: 15 } as const;
const note = { type: "text" as const, text: `<b>${SIM_NOTE}</b>` };

function dashed(color: number[], width: number) {
  return new SimpleLineSymbol({ color, width, style: "dash" });
}

function marker(style: "circle" | "diamond", color: number[], size: number) {
  return new SimpleMarkerSymbol({ style, color, size, outline: { color: [255, 255, 255, 1], width: 1.2, style: "dash" } });
}

function territoryLayer(dataBaseUrl: string): GeoJSONLayer {
  return new GeoJSONLayer({
    ...simOptions,
    url: `${dataBaseUrl}/sim/territory.geojson`,
    title: "Simulated service territory",
    geometryType: "polygon",
    fields: [
      { name: "utility", type: "string" },
      { name: "customers", type: "integer" },
      { name: "feeders", type: "integer" },
    ],
    renderer: new SimpleRenderer({
      label: "StormX Demo Electric (simulated)",
      symbol: new SimpleFillSymbol({ style: "backward-diagonal", color: [196, 120, 0, 0.7], outline: dashed([196, 120, 0, 1], 1.6) }),
    }),
    popupTemplate: {
      title: "{utility} (simulated)",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "customers", label: "Customers", format: { digitSeparator: true, places: 0 } },
            { fieldName: "feeders", label: "Feeders" },
          ],
        },
        note,
      ],
    },
  });
}

function feedersLayer(dataBaseUrl: string): GeoJSONLayer {
  return new GeoJSONLayer({
    ...simOptions,
    url: `${dataBaseUrl}/sim/feeders.geojson`,
    title: "Simulated feeders",
    geometryType: "polyline",
    fields: [
      { name: "feeder", type: "string" },
      { name: "substation", type: "string" },
      { name: "km", type: "double" },
      { name: "customers", type: "integer" },
      { name: "customers_out", type: "integer" },
      { name: "status", type: "string" },
      { name: "risk", type: "integer" },
      { name: "hazard", type: "string" },
    ],
    renderer: new UniqueValueRenderer({
      field: "status",
      legendOptions: { title: "Feeder status (simulated)" },
      uniqueValueInfos: [
        { value: "Normal", label: "Normal", symbol: dashed([0, 128, 128, 0.9], 1.6) },
        { value: "Partial outage", label: "Partial outage", symbol: dashed([230, 120, 0, 1], 2.4) },
        { value: "Locked out", label: "Locked out", symbol: dashed([200, 20, 40, 1], 3) },
      ],
    }),
    popupTemplate: {
      title: "Feeder {feeder}, {substation} substation (simulated)",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "status", label: "Status" },
            { fieldName: "customers_out", label: "Customers out", format: { digitSeparator: true, places: 0 } },
            { fieldName: "customers", label: "Customers on the feeder", format: { digitSeparator: true, places: 0 } },
            { fieldName: "km", label: "Length (km)", format: { places: 1 } },
            { fieldName: "risk", label: "Live outage risk over the feeder (real index)" },
            { fieldName: "hazard", label: "Worst hazard (real)" },
          ],
        },
        note,
      ],
    },
  });
}

function substationsLayer(dataBaseUrl: string): GeoJSONLayer {
  return new GeoJSONLayer({
    ...simOptions,
    url: `${dataBaseUrl}/sim/substations.geojson`,
    title: "Simulated substations",
    geometryType: "point",
    fields: [
      { name: "name", type: "string" },
      { name: "feeders", type: "integer" },
      { name: "feeder_ids", type: "string" },
    ],
    renderer: new SimpleRenderer({ label: "Substation (simulated)", symbol: marker("diamond", [84, 39, 143, 1], 13) }),
    popupTemplate: {
      title: "{name} substation (simulated)",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "feeders", label: "Feeders" },
            { fieldName: "feeder_ids", label: "Feeder numbers" },
          ],
        },
        note,
      ],
    },
  });
}

function ticketsLayer(dataBaseUrl: string): GeoJSONLayer {
  return new GeoJSONLayer({
    ...simOptions,
    url: `${dataBaseUrl}/sim/tickets.geojson`,
    title: "Simulated outage tickets",
    geometryType: "point",
    fields: [
      { name: "ticket", type: "string" },
      { name: "feeder", type: "string" },
      { name: "substation", type: "string" },
      { name: "cause", type: "string" },
      { name: "scope", type: "string" },
      { name: "status", type: "string" },
      { name: "customers_out", type: "integer" },
      { name: "customers_affected", type: "integer" },
      { name: "reported", type: "date" },
    ],
    orderBy: [{ field: "reported", order: "descending" }],
    renderer: new UniqueValueRenderer({
      field: "status",
      legendOptions: { title: "Ticket status (simulated)" },
      uniqueValueInfos: [
        { value: "Reported", label: "Reported", symbol: marker("circle", [200, 20, 40, 1], 12) },
        { value: "Crew assigned", label: "Crew assigned", symbol: marker("circle", [230, 120, 0, 1], 12) },
        { value: "Crew on site", label: "Crew on site", symbol: marker("circle", [240, 190, 0, 1], 12) },
        { value: "Restored", label: "Restored", symbol: marker("circle", [130, 130, 130, 0.8], 8) },
      ],
    }),
    popupTemplate: {
      title: "Ticket {ticket} (simulated)",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "status", label: "Status" },
            { fieldName: "cause", label: "Cause" },
            { fieldName: "scope", label: "Scope" },
            { fieldName: "customers_out", label: "Customers still out", format: { digitSeparator: true, places: 0 } },
            { fieldName: "customers_affected", label: "Customers affected", format: { digitSeparator: true, places: 0 } },
            { fieldName: "reported", label: "Reported", format: { dateFormat: "short-date-short-time" } },
            { fieldName: "feeder", label: "Feeder" },
            { fieldName: "substation", label: "Substation" },
          ],
        },
        note,
      ],
    },
  });
}

export interface SimLayers {
  group: GroupLayer;
  /** For zooming to the demo from the Simulated data ribbon. */
  territory: GeoJSONLayer;
}

export function createSimLayers(dataBaseUrl: string): SimLayers {
  const territory = territoryLayer(dataBaseUrl);
  const group = new GroupLayer({
    title: "Simulated utility: StormX Demo Electric · Simulated",
    visibilityMode: "independent",
    layers: [territory, feedersLayer(dataBaseUrl), substationsLayer(dataBaseUrl), ticketsLayer(dataBaseUrl)],
  });
  return { group, territory };
}
