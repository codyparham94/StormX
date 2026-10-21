/**
 * The map shared by Radar and Outage risk mode. Loaded only when a map mode first opens, so the
 * landing page doesn't wait for the ArcGIS SDK.
 */
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-scale-bar";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-time-slider";
import esriConfig from "@arcgis/core/config.js";
import Basemap from "@arcgis/core/Basemap.js";
import Graphic from "@arcgis/core/Graphic.js";
import EsriMap from "@arcgis/core/Map.js";
import Point from "@arcgis/core/geometry/Point.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import TileLayer from "@arcgis/core/layers/TileLayer.js";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";
import {
  ARCGIS_API_KEY,
  BASEMAP_STYLE_DARK,
  BASEMAP_STYLE_LIGHT,
  DATA_BASE_URL,
  FALLBACK_TILES_DARK,
  FALLBACK_TILES_LIGHT,
} from "./config";
import type { Place } from "./forecast";
import { ago } from "./forecast-format";
import { MODES, type Mode } from "./modes";
import { createOutageLayers } from "./outage-layers";
import { outageStatus, type OutageSummary } from "./outage-format";
import { createRadarLayers } from "./radar-layers";
import { setUpRadarLoop } from "./radar-loop";

type MapElement = HTMLElement & {
  map: EsriMap;
  center: Point;
  zoom: number;
  viewOnReady(): Promise<void>;
  goTo(target: { center: Point; zoom: number } | Graphic, options?: { animate?: boolean }): Promise<unknown>;
};

export interface MapApp {
  showMode(mode: Mode, fromLanding: boolean): void;
  setDark(dark: boolean): void;
  markPlace(place: Place): void;
}

function basemapFor(dark: boolean): Basemap {
  if (ARCGIS_API_KEY) return new Basemap({ style: { id: dark ? BASEMAP_STYLE_DARK : BASEMAP_STYLE_LIGHT } });
  return new Basemap({ baseLayers: [new TileLayer({ url: dark ? FALLBACK_TILES_DARK : FALLBACK_TILES_LIGHT })] });
}

export async function startMap(dark: boolean): Promise<MapApp> {
  if (ARCGIS_API_KEY) esriConfig.apiKey = ARCGIS_API_KEY;
  else document.getElementById("basemap-notice")?.removeAttribute("hidden");

  const element = document.querySelector<MapElement>("arcgis-map");
  if (!element) throw new Error("Map element missing");

  let currentDark = dark;
  const places = new GraphicsLayer({ title: "Forecast place", listMode: "hide" });
  const radar = createRadarLayers(DATA_BASE_URL);
  const modeLayers: Record<Mode, Layer[]> = { radar: radar.groups, outage: createOutageLayers(DATA_BASE_URL) };

  element.map = new EsriMap({ basemap: basemapFor(dark), layers: [places] });
  const start = MODES.radar;
  element.center = new Point({ longitude: start.center[0], latitude: start.center[1] });
  element.zoom = start.zoom;
  await element.viewOnReady();

  const slider = document.querySelector("arcgis-time-slider") as Parameters<typeof setUpRadarLoop>[0] | null;
  const latest = document.getElementById("radar-latest");
  let latestScan: Date | undefined;
  const showLatest = () => latest && latestScan && (latest.textContent = `Latest radar scan ${ago(latestScan)}`);
  if (slider)
    setUpRadarLoop(slider, (time) => {
      latestScan = time;
      showLatest();
    });
  window.setInterval(showLatest, 30_000);

  const outageLine = document.getElementById("outage-status");
  let summary: OutageSummary | undefined;
  const showOutages = () => outageLine && summary && (outageLine.textContent = outageStatus(summary));
  async function refreshOutages() {
    if (!DATA_BASE_URL || !outageLine) return;
    try {
      const response = await fetch(`${DATA_BASE_URL}/live/outages/summary.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      summary = (await response.json()) as OutageSummary;
      showOutages();
    } catch {
      outageLine.textContent = "Current outages are unavailable right now.";
    }
  }
  window.setInterval(() => (shown === "outage" ? void refreshOutages() : undefined), 5 * 60_000);
  window.setInterval(showOutages, 30_000);

  let shown: Mode | undefined;
  return {
    showMode(mode, fromLanding) {
      if (mode !== shown) {
        if (shown) element.map.layers.removeMany(modeLayers[shown]);
        // Under the place marker, which stays on top in both modes.
        element.map.layers.addMany(modeLayers[mode], 0);
        shown = mode;
        showLatest();
        if (mode === "outage" && !summary) void refreshOutages();
      }
      // Switching modes keeps the place; only arriving from the landing page jumps to the mode's region.
      if (!fromLanding) return;
      const { center, zoom } = MODES[mode];
      // Phones need one level less to fit the same region.
      const fit = window.innerWidth < 600 ? zoom - 1 : zoom;
      void element.goTo({ center: new Point({ longitude: center[0], latitude: center[1] }), zoom: fit }, { animate: false });
    },
    setDark(next) {
      if (next === currentDark) return;
      currentDark = next;
      element.map.basemap = basemapFor(next);
    },
    markPlace(place) {
      const marker = new Graphic({
        geometry: new Point({ longitude: place.lon, latitude: place.lat }),
        symbol: new SimpleMarkerSymbol({ style: "circle", size: 14, color: [22, 120, 201, 0.9], outline: { color: [255, 255, 255, 1], width: 2.5 } }),
        attributes: { label: place.label },
      });
      places.removeAll();
      places.add(marker);
      void element.goTo({ center: marker.geometry as Point, zoom: Math.max(element.zoom, 8) });
    },
  };
}
