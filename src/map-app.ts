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
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import Basemap from "@arcgis/core/Basemap.js";
import Graphic from "@arcgis/core/Graphic.js";
import EsriMap from "@arcgis/core/Map.js";
import type Extent from "@arcgis/core/geometry/Extent.js";
import Point from "@arcgis/core/geometry/Point.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
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
import type { ReplayHost } from "./history";
import { ago } from "./forecast-format";
import { MODES, type Mode } from "./modes";
import { createOutageLayers } from "./outage-layers";
import { outageStatus, type OutageSummary } from "./outage-format";
import { createRadarLayers } from "./radar-layers";
import { setUpRadarLoop } from "./radar-loop";
import { riskStatus, type RiskSummary } from "./risk-format";
import { simStatus, type SimSummary } from "./sim-format";

type MapElement = HTMLElement & {
  map: EsriMap;
  center: Point;
  zoom: number;
  viewOnReady(): Promise<void>;
  goTo(target: { center: Point; zoom: number } | Graphic | Extent, options?: { animate?: boolean }): Promise<unknown>;
};

export interface MapApp extends ReplayHost {
  showMode(mode: Mode, fromLanding: boolean): void;
  setDark(dark: boolean): void;
  markPlace(place: Place): void;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
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
  const outage = createOutageLayers(DATA_BASE_URL);
  const modeLayers: Record<Mode, Layer[]> = { radar: radar.groups, outage: outage.layers };
  let replay: FeatureLayer | null = null;
  let hiddenLive: Layer[] = [];

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

  // The risk index and the simulated utility update hourly, together.
  const riskLine = document.getElementById("risk-status");
  const simLine = document.getElementById("sim-status");
  let riskSummary: RiskSummary | undefined;
  let riskLoaded = false;
  const showRisk = () => riskLine && riskSummary && (riskLine.textContent = riskStatus(riskSummary));
  async function refreshRisk() {
    if (!DATA_BASE_URL || !outage.risk) return;
    riskLoaded = true;
    const [risk, sim, hexes] = await Promise.allSettled([
      getJson<RiskSummary>(`${DATA_BASE_URL}/risk/summary.json`),
      getJson<SimSummary>(`${DATA_BASE_URL}/sim/summary.json`),
      outage.risk.refresh(),
    ]);
    if (risk.status === "fulfilled") {
      riskSummary = risk.value;
      showRisk();
    } else if (riskLine) riskLine.textContent = "The outage risk index is unavailable right now.";
    if (simLine) simLine.textContent = sim.status === "fulfilled" ? simStatus(sim.value) : "The demo utility is unavailable right now.";
    if (hexes.status === "rejected") console.error(hexes.reason);
  }
  window.setInterval(() => (shown === "outage" ? void refreshRisk() : undefined), 15 * 60_000);
  window.setInterval(showRisk, 30_000);

  const ribbon = document.getElementById("sim-ribbon");
  const sim = outage.sim;
  const showRibbon = () => ribbon && (ribbon.hidden = !(shown === "outage" && sim?.group.visible));
  if (sim) {
    reactiveUtils.watch(() => sim.group.visible, showRibbon);
    ribbon?.addEventListener("click", () => {
      void sim.territory.queryExtent().then(({ extent }) => extent && element.goTo(extent.expand(1.4)));
    });
  }

  let shown: Mode | undefined;
  return {
    showMode(mode, fromLanding) {
      if (mode !== shown) {
        if (shown) element.map.layers.removeMany(modeLayers[shown]);
        // Under the place marker, which stays on top in both modes.
        element.map.layers.addMany(modeLayers[mode], 0);
        shown = mode;
        showLatest();
        showRibbon();
        if (mode === "outage" && !summary) void refreshOutages();
        if (mode === "outage" && !riskLoaded) void refreshRisk();
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
    showReplay(layer, focus) {
      if (replay) {
        modeLayers.outage = modeLayers.outage.filter((l) => l !== replay);
        element.map.layers.remove(replay);
      }
      replay = layer;
      // Remember which live layers were on, so stopping the replay restores the visitor's choice.
      if (layer && !hiddenLive.length) {
        hiddenLive = outage.live.filter((l) => l.visible);
        hiddenLive.forEach((l) => (l.visible = false));
      } else if (!layer) {
        hiddenLive.forEach((l) => (l.visible = true));
        hiddenLive = [];
      }
      if (!layer) return;
      // Over the outage fills but under the grid, so it leaves with the mode like the rest.
      const gridIndex = modeLayers.outage.indexOf(outage.grid);
      modeLayers.outage.splice(gridIndex, 0, layer);
      if (shown === "outage") element.map.layers.add(layer, element.map.layers.indexOf(modeLayers.outage[gridIndex + 1]));
      if (focus) void element.goTo(focus.expand(1.2));
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
