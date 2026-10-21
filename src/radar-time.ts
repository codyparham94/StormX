/** Radar loop arithmetic, kept free of SDK imports so it can be unit tested. */

export const STEP_MINUTES = 5;

/** The latest stop at or before `end`, aligned to the slider's 5-minute grid from `start`. */
export function lastStop(start: number, end: number, stepMinutes = STEP_MINUTES): number {
  const step = stepMinutes * 60_000;
  return start + Math.floor((end - start) / step) * step;
}

/** The service's time window as [start, end] in epoch ms, from its JSON description. */
export function serviceWindow(info: { timeInfo?: { timeExtent?: [number, number] } }): [number, number] | null {
  const extent = info.timeInfo?.timeExtent;
  if (!extent || extent.length !== 2 || !(extent[1] > extent[0])) return null;
  return [extent[0], extent[1]];
}
