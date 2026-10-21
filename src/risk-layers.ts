/**
 * The live outage risk index on the map. The risk ETL sends each H3 hex as a compact row and h3-js
 * draws its outline here, which keeps the hourly file a tenth the size of GeoJSON. A county layer
 * on top carries each county's worst hex in its popup.
 */
import Graphic from "@arcgis/core/Graphic.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import GroupLayer from "@arcgis/core/layers/GroupLayer.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import ClassBreaksRenderer from "@arcgis/core/renderers/ClassBreaksRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol.js";
import { RISK_LEVELS, hexRing, riskRows, type RiskCells } from "./risk-format";

const untimed = { useViewTime: false } as const;

const ABOUT =
  "The StormX risk index (0 to 100) is a weighted model, not an official forecast. It multiplies the worst hazard over the hex " +
  "(SPC outlooks, NHC wind probabilities, WPC winter impacts and NWS warnings) by what's on the ground (HIFLD lines and " +
  "substations, EAGLE-I customers) and the county's outage history. Real inputs, updated hourly.";

const HEX_FIELDS = [
  { name: "oid", type: "oid" },
  { name: "cell", type: "string" },
  { name: "risk", type: "integer" },
  { name: "level", type: "string" },
  { name: "hazard", type: "double" },
  { name: "driver", type: "string" },
  { name: "exposure", type: "double" },
  { name: "vulnerability", type: "double" },
  { name: "line_km", type: "double" },
  { name: "substations", type: "integer" },
  { name: "customers", type: "integer" },
  { name: "customers_affected", type: "integer" },
  { name: "fips", type: "string" },
] as const;

function riskRenderer(fillAlpha: number, outline: (color: readonly number[]) => SimpleLineSymbol): ClassBreaksRenderer {
  return new ClassBreaksRenderer({
    field: "risk",
    legendOptions: { title: "Outage risk (0 to 100)" },
    classBreakInfos: RISK_LEVELS.map((l) => ({
      minValue: l.min,
      maxValue: l.max - 0.001,
      label: `${l.name} (${l.min} to ${Math.min(l.max - 1, 100)})`,
      symbol: new SimpleFillSymbol({ color: [...l.color, fillAlpha], outline: outline(l.color) }),
    })),
  });
}

const hexPopup = {
  title: "Outage risk: {level} ({risk} of 100)",
  content: [
    {
      type: "fields" as const,
      fieldInfos: [
        { fieldName: "driver", label: "Worst hazard" },
        { fieldName: "customers_affected", label: "Customers who could lose power (rough estimate)", format: { digitSeparator: true, places: 0 } },
        { fieldName: "customers", label: "Customers in this hex (modeled)", format: { digitSeparator: true, places: 0 } },
        { fieldName: "line_km", label: "Transmission lines (km)", format: { places: 1 } },
        { fieldName: "substations", label: "Substations" },
        { fieldName: "hazard", label: "Hazard score (0 to 1)", format: { places: 2 } },
        { fieldName: "exposure", label: "Exposure score (0 to 1)", format: { places: 2 } },
        { fieldName: "vulnerability", label: "Vulnerability score (0 to 1)", format: { places: 2 } },
      ],
    },
    { type: "text" as const, text: ABOUT },
  ],
};

function hexLayer(source: Graphic[]): FeatureLayer {
  return new FeatureLayer({
    ...untimed,
    source,
    title: "Outage risk by hex (H3, about 36 km²)",
    copyright: "StormX risk index from NOAA SPC, NHC, WPC, NWS; HIFLD; ORNL EAGLE-I",
    geometryType: "polygon",
    spatialReference: { wkid: 4326 },
    objectIdField: "oid",
    fields: HEX_FIELDS.map((f) => ({ ...f })),
    opacity: 0.8,
    renderer: riskRenderer(0.75, () => new SimpleLineSymbol({ color: [255, 255, 255, 0], width: 0 })),
    popupTemplate: hexPopup,
  });
}

function countyLayer(dataBaseUrl: string): GeoJSONLayer {
  return new GeoJSONLayer({
    ...untimed,
    url: `${dataBaseUrl}/risk/counties.geojson`,
    title: "Outage risk by county (worst hex)",
    copyright: "StormX risk index",
    refreshInterval: 15,
    geometryType: "polygon",
    fields: [
      { name: "fips", type: "string" },
      { name: "name", type: "string" },
      { name: "state", type: "string" },
      { name: "risk", type: "integer" },
      { name: "level", type: "string" },
      { name: "driver", type: "string" },
      { name: "customers", type: "integer" },
      { name: "customers_affected", type: "integer" },
      { name: "elevated_cells", type: "integer" },
      { name: "hours_per_customer", type: "double" },
    ],
    // Outlines only, so the hexes show through; the faint fill keeps the whole county clickable.
    renderer: riskRenderer(0.02, (color) => new SimpleLineSymbol({ color: [...color, 1], width: 1.4 })),
    popupTemplate: {
      title: "{name}, {state}: {level} outage risk",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "risk", label: "Worst hex (0 to 100)" },
            { fieldName: "driver", label: "Worst hazard" },
            { fieldName: "customers_affected", label: "Customers who could lose power (rough estimate)", format: { digitSeparator: true, places: 0 } },
            { fieldName: "customers", label: "Customers in the county (modeled)", format: { digitSeparator: true, places: 0 } },
            { fieldName: "elevated_cells", label: "Hexes at Elevated or above" },
            { fieldName: "hours_per_customer", label: "Past outage hours per customer, yearly (EAGLE-I)", format: { places: 1 } },
          ],
        },
        { type: "text", text: ABOUT },
      ],
    },
  });
}

export interface RiskLayers {
  group: GroupLayer;
  /** Loads the latest hexes, unless the file hasn't changed since the last load. */
  refresh(): Promise<void>;
}

export function createRiskLayers(dataBaseUrl: string, heatmap: Layer): RiskLayers {
  let hexes = hexLayer([]);
  const counties = countyLayer(dataBaseUrl);
  const group = new GroupLayer({
    title: "Outage risk now · Real data, StormX model",
    visibilityMode: "independent",
    layers: [heatmap, hexes, counties],
  });
  let loaded = "";

  async function refresh() {
    const response = await fetch(`${dataBaseUrl}/risk/h3-res6.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status} for the risk index`);
    const file = (await response.json()) as RiskCells;
    if (file.meta.updated === loaded) return;
    // Only Outage risk mode needs h3-js, so it loads on first use.
    const { cellToBoundary } = await import("h3-js");
    const source = riskRows(file).flatMap((row, i) => {
      const ring = hexRing(cellToBoundary(row.cell, true));
      if (!ring) return [];
      const geometry = new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
      return [new Graphic({ geometry, attributes: { oid: i + 1, ...row } })];
    });
    // A client-side layer can't swap its source, so the new hexes take the old layer's place.
    const next = Object.assign(hexLayer(source), { visible: hexes.visible });
    const index = group.layers.indexOf(hexes);
    group.layers.splice(index, 1, next);
    hexes.destroy();
    hexes = next;
    loaded = file.meta.updated;
  }

  return { group, refresh };
}
