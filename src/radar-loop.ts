/**
 * The radar loop: the time slider steps through MRMS scans (5-minute stops over the service's
 * moving window) and follows new scans as they arrive.
 */
import TimeExtent from "@arcgis/core/time/TimeExtent.js";
import { MRMS_URL } from "./radar-layers";
import { STEP_MINUTES, lastStop, serviceWindow } from "./radar-time";

const REFRESH_MS = 5 * 60 * 1000;

type Slider = HTMLElement & {
  fullTimeExtent: TimeExtent | null | undefined;
  timeExtent: TimeExtent | null | undefined;
  stops: { interval: { value: number; unit: "minutes" } } | null | undefined;
  mode: string;
  loop: boolean;
  playRate: number;
  timeVisible: boolean;
  viewModel?: { state: string };
};

async function fetchWindow(): Promise<[number, number] | null> {
  const response = await fetch(`${MRMS_URL}?f=json`);
  if (!response.ok) return null;
  return serviceWindow(await response.json());
}

export function setUpRadarLoop(slider: Slider, onLatest: (time: Date) => void): () => void {
  slider.mode = "instant";
  slider.loop = true;
  slider.playRate = 700;
  slider.timeVisible = true;
  slider.stops = { interval: { value: STEP_MINUTES, unit: "minutes" } };

  let following = true;
  slider.addEventListener("arcgisPropertyChange", (event) => {
    const name = (event as CustomEvent<{ name: string }>).detail?.name;
    if (name !== "timeExtent" || !slider.fullTimeExtent?.end || !slider.timeExtent?.start) return;
    const playing = slider.viewModel?.state === "playing";
    // Leaving the newest scan by hand stops the slider from jumping ahead on refresh.
    if (!playing) following = slider.timeExtent.start.getTime() >= lastStop(slider.fullTimeExtent.start!.getTime(), slider.fullTimeExtent.end.getTime());
  });

  const update = async () => {
    const window = await fetchWindow().catch(() => null);
    if (!window) return;
    const [start, end] = window;
    slider.fullTimeExtent = new TimeExtent({ start: new Date(start), end: new Date(end) });
    const latest = new Date(lastStop(start, end));
    if (following && slider.viewModel?.state !== "playing") slider.timeExtent = new TimeExtent({ start: latest, end: latest });
    onLatest(new Date(end));
  };
  void update();
  const timer = window.setInterval(() => void update(), REFRESH_MS);
  return () => window.clearInterval(timer);
}
