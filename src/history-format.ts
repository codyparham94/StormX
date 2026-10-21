/**
 * The outage history replay's data handling, kept apart from the map so it can be tested. The ETL
 * writes one file per month with each county's peak customers out per day (EAGLE-I, UTC days).
 */

export interface OutageEvent {
  start: string;
  end: string;
  peak_day: string;
  peak: number;
  states: string[];
}

export interface MonthFile {
  days: string[];
  /** The worst 15-minute national total each day. */
  national?: number[];
  peak: Record<string, number[]>;
}

export interface CountyFeature {
  type: "Feature";
  geometry: unknown;
  properties: { fips: string; name: string; state: string; customers: number | null };
}

/** The longest replay, so a window stays a quick download of one or two month files. */
export const MAX_DAYS = 14;
export const FIRST_DAY = "2014-11-01";
export const LAST_DAY = "2025-12-31";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("en-US");

export function dayLabel(day: string, withYear = true): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function eventLabel(event: OutageEvent): string {
  const sameMonth = event.start.slice(0, 7) === event.end.slice(0, 7);
  const endLabel = sameMonth ? `${Number(event.end.slice(8))}, ${event.end.slice(0, 4)}` : dayLabel(event.end);
  const range = event.start === event.end ? dayLabel(event.start) : `${dayLabel(event.start, false)} to ${endLabel}`;
  const where = event.states.length ? `: ${event.states.join(", ")}` : "";
  return `${range}${where} (${compact.format(event.peak)} out at peak)`;
}

/** The days from start to end inclusive, capped at MAX_DAYS. */
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && days.length < MAX_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** A window of `length` days starting at `start`, kept inside the data's range. */
export function windowFrom(start: string, length = 10): string[] {
  const from = start < FIRST_DAY ? FIRST_DAY : start > LAST_DAY ? LAST_DAY : start;
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + length - 1);
  const to = end.toISOString().slice(0, 10);
  return daysBetween(from, to > LAST_DAY ? LAST_DAY : to);
}

export function monthsFor(days: string[]): string[] {
  return [...new Set(days.map((d) => d.slice(0, 7)))];
}

/** Each county's peak per day of the window, for counties with any outage in it. */
export function peaksForWindow(days: string[], months: MonthFile[]): Map<string, number[]> {
  const peaks = new Map<string, number[]>();
  const index = new Map<string, [MonthFile, number]>();
  for (const month of months) month.days.forEach((day, i) => index.set(day, [month, i]));
  days.forEach((day, d) => {
    const found = index.get(day);
    if (!found) return;
    const [month, i] = found;
    for (const [fips, series] of Object.entries(month.peak)) {
      const out = series[i] ?? 0;
      if (!out) continue;
      let row = peaks.get(fips);
      if (!row) peaks.set(fips, (row = new Array<number>(days.length).fill(0)));
      row[d] = out;
    }
  });
  return peaks;
}

type Ring = number[][];

/** A GeoJSON Polygon or MultiPolygon as one list of rings, the way ArcGIS polygons hold them. */
export function toRings(geometry: unknown): Ring[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (g?.type === "Polygon") return g.coordinates as Ring[];
  if (g?.type === "MultiPolygon") return (g.coordinates as Ring[][]).flat();
  return [];
}

export interface ReplayCounty {
  rings: Ring[];
  attributes: Record<string, string | number | null>;
}

/** The counties hit in the window, with d0, d1, ... as each day's peak customers out. */
export function replayCounties(counties: CountyFeature[], peaks: Map<string, number[]>): ReplayCounty[] {
  return counties.flatMap((county, i) => {
    const row = peaks.get(county.properties.fips);
    const rings = toRings(county.geometry);
    if (!row || !rings.length) return [];
    const days = Object.fromEntries(row.map((out, d) => [`d${d}`, out]));
    return [{ rings, attributes: { oid: i + 1, ...county.properties, ...days } }];
  });
}

/** The worst national total each day of the window, from the month files. */
export function nationalTotals(days: string[], months: MonthFile[]): number[] {
  const byDay = new Map<string, number>();
  for (const month of months) month.days.forEach((day, i) => byDay.set(day, month.national?.[i] ?? 0));
  return days.map((day) => byDay.get(day) ?? 0);
}

export function dayStatus(day: string, total: number): string {
  return `${dayLabel(day)}: ${count.format(total)} customers out at the worst point`;
}
