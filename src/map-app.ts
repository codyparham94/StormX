/**
 * The map shared by Radar and Outage risk mode. Loaded only when a map mode first opens, so the
 * landing page doesn't wait for the ArcGIS SDK.
 */
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-scale-bar";
import esriConfig from "@arcgis/core/config.js";
import Basemap from "@arcgis/core/Basemap.js";
import EsriMap from "@arcgis/core/Map.js";
import Point from "@arcgis/core/geometry/Point.js";
import TileLayer from "@arcgis/core/layers/TileLayer.js";
import {
  ARCGIS_API_KEY,
  BASEMAP_STYLE_DARK,
  BASEMAP_STYLE_LIGHT,
  FALLBACK_TILES_DARK,
  FALLBACK_TILES_LIGHT,
} from "./config";
import { MODES, type Mode } from "./modes";

type MapElement = HTMLElement & {
  map: EsriMap;
  center: Point;
  zoom: number;
  viewOnReady(): Promise<void>;
  goTo(target: { center: Point; zoom: number }, options?: { animate?: boolean }): Promise<unknown>;
};

export interface MapApp {
  showMode(mode: Mode, fromLanding: boolean): void;
  setDark(dark: boolean): void;
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
  element.map = new EsriMap({ basemap: basemapFor(dark) });
  const start = MODES.radar;
  element.center = new Point({ longitude: start.center[0], latitude: start.center[1] });
  element.zoom = start.zoom;
  await element.viewOnReady();

  return {
    showMode(mode, fromLanding) {
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
  };
}
