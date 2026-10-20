import "@esri/calcite-components/components/calcite-segmented-control";
import "@esri/calcite-components/components/calcite-segmented-control-item";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-notice";
import "@esri/calcite-components/components/calcite-loader";

import "./style.css";
import { MODES, lastMode, parseRoute, rememberMode, routeHash, type Mode, type Route } from "./modes";
import { setUpTheme } from "./theme";
import type { MapApp } from "./map-app";

const landing = document.getElementById("landing") as HTMLElement;
const app = document.getElementById("app") as HTMLElement;
const modeSwitch = document.getElementById("mode-switch") as HTMLElement & { value: string };
const modeTitle = document.getElementById("mode-title") as HTMLElement;
const modeSummary = document.getElementById("mode-summary") as HTMLElement;
const modeNext = document.querySelectorAll<HTMLElement>("[data-mode-next]");

let mapApp: Promise<MapApp> | undefined;
let showing: Route["screen"] | undefined;

const isDark = setUpTheme((dark) => {
  void mapApp?.then((m) => m.setDark(dark));
});

function loadMap(): Promise<MapApp> {
  mapApp ??= import("./map-app").then(({ startMap }) => startMap(isDark()));
  mapApp
    .catch((error: unknown) => {
      console.error(error);
      document.getElementById("map-error")?.removeAttribute("hidden");
    })
    .finally(() => document.getElementById("map-loader")?.setAttribute("hidden", ""));
  return mapApp;
}

function show(route: Route): void {
  const previous = showing;
  showing = route.screen;
  landing.hidden = route.screen !== "landing";
  app.hidden = route.screen !== "map";
  document.title = route.screen === "map" ? `${MODES[route.mode].label} · StormX` : "StormX: storms and utility outage risk";
  if (route.screen === "landing") return;

  const { mode } = route;
  rememberMode(mode);
  // Check the item itself: the control's value isn't settable until Calcite has defined it.
  modeSwitch.querySelectorAll<HTMLElement & { checked: boolean }>("calcite-segmented-control-item").forEach((item) => {
    item.checked = item.getAttribute("value") === mode;
  });
  document.body.dataset.mode = mode;
  modeTitle.textContent = MODES[mode].label;
  modeSummary.textContent = MODES[mode].summary;
  modeNext.forEach((item) => (item.hidden = item.dataset.modeNext !== mode));
  void loadMap().then((m) => m.showMode(mode, previous !== "map"));
}

function go(route: Route): void {
  const hash = routeHash(route);
  if (window.location.hash === hash) show(route);
  else window.location.hash = hash;
}

document.querySelectorAll<HTMLElement>("[data-open-mode]").forEach((button) =>
  button.addEventListener("click", () => go({ screen: "map", mode: button.dataset.openMode as Mode })),
);
modeSwitch.addEventListener("calciteSegmentedControlChange", () => go({ screen: "map", mode: modeSwitch.value as Mode }));
window.addEventListener("hashchange", () => show(parseRoute(window.location.hash)));

// A bare visit goes straight to the mode picked last time; the StormX wordmark (#/) always shows the landing page.
const initial = parseRoute(window.location.hash);
const remembered = lastMode();
if (!window.location.hash && remembered) go({ screen: "map", mode: remembered });
else show(initial);

// The remembered mode is the landing page's default button.
if (remembered) document.querySelector<HTMLElement>(`[data-open-mode="${remembered}"]`)?.classList.add("last-used");
