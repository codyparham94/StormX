/** Build-time configuration. Every value here ships to the browser and is public by design. */

/** Basemap-only, referrer-restricted ArcGIS Location Platform key. Empty in builds without one. */
export const ARCGIS_API_KEY: string = import.meta.env.VITE_ARCGIS_API_KEY ?? "";

/**
 * The data Worker that serves the ETL output from R2 (workers/data), for example
 * https://stormx-data.<account>.workers.dev. No trailing slash. Not read yet: the first data
 * layers arrive in Phase 2.
 */
export const DATA_BASE_URL: string = (import.meta.env.VITE_DATA_BASE_URL ?? "").replace(/\/+$/, "");

/** Supabase project for optional accounts (Phase 4). The anon key is public; row-level security guards the data. */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** Esri basemap styles for light and dark mode, both in the free basemap styles service. */
export const BASEMAP_STYLE_LIGHT = "arcgis/light-gray";
export const BASEMAP_STYLE_DARK = "arcgis/dark-gray";

/**
 * Keyless fallbacks for local builds without a key: the same canvases as plain tile services.
 * Production always has the key, so these only keep `npm run dev` usable.
 */
export const FALLBACK_TILES_LIGHT = "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer";
export const FALLBACK_TILES_DARK = "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer";
