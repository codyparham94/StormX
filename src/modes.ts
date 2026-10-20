/**
 * The site's screens and the hash routes that pick them: the landing page and the two map modes.
 * The map modes share one map, so switching keeps the place the visitor is looking at.
 */

export type Mode = "radar" | "outage";
export type Route = { screen: "landing" } | { screen: "map"; mode: Mode };

export interface ModeInfo {
  label: string;
  /** Where the mode opens when nothing else (a previous view, later a location or saved place) says otherwise. */
  center: [number, number];
  zoom: number;
  summary: string;
}

export const MODES: Record<Mode, ModeInfo> = {
  radar: {
    label: "Radar",
    // The lower 48, framed so the Gulf and the Canadian border both show.
    center: [-97.5, 38.5],
    zoom: 4,
    summary: "National radar loop, NWS alerts, severe and tropical outlooks, fire, and a forecast by ZIP or location.",
  },
  outage: {
    label: "Outage risk",
    // The Gulf Coast demo region, from Houston to Mobile.
    center: [-91.5, 30.3],
    zoom: 6,
    summary: "Current outages, the power grid, the storm risk index, outage history and the simulated Gulf Coast utility.",
  },
};

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  if (path === "radar" || path === "outage") return { screen: "map", mode: path };
  return { screen: "landing" };
}

export function routeHash(route: Route): string {
  return route.screen === "landing" ? "#/" : `#/${route.mode}`;
}

const LAST_MODE_KEY = "stormx-mode";

/** The mode picked last time in this browser, or null. */
export function lastMode(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Mode | null {
  try {
    const value = storage?.getItem(LAST_MODE_KEY);
    return value === "radar" || value === "outage" ? value : null;
  } catch {
    return null;
  }
}

export function rememberMode(mode: Mode, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(LAST_MODE_KEY, mode);
  } catch {
    // Storage blocked: the landing page asks again next time.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
