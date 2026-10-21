/** Formatting for the forecast popup, kept free of the DOM and the SDK so it can be unit tested. */

/** A U.S. ZIP code (5 digits, optionally ZIP+4), or null. */
export function parseZip(input: string): string | null {
  const match = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(input);
  return match ? match[1] : null;
}

/** The NWS API wants at most four decimals in /points. */
export function pointsPath(lat: number, lon: number): string {
  const fix = (n: number) => String(Math.round(n * 10_000) / 10_000);
  return `/points/${fix(lat)},${fix(lon)}`;
}

export function celsiusToF(c: number | null | undefined): number | null {
  return c === null || c === undefined || Number.isNaN(c) ? null : Math.round((c * 9) / 5 + 32);
}

export function kmhToMph(kmh: number | null | undefined): number | null {
  return kmh === null || kmh === undefined || Number.isNaN(kmh) ? null : Math.round(kmh / 1.609344);
}

/** "3 PM" in the forecast point's own time zone. */
export function hourLabel(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone }).format(new Date(iso));
}

/** "3 min ago", "2 hr ago" or "just now" for a past timestamp. */
export function ago(then: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

export type Severity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

/** Alerts sorted most severe first, then by soonest end. */
export function sortAlerts<T extends { severity?: string; ends?: string | null; expires?: string | null }>(alerts: T[]): T[] {
  const rank: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
  const end = (a: T) => Date.parse(a.ends ?? a.expires ?? "") || Infinity;
  return [...alerts].sort((a, b) => (rank[a.severity ?? ""] ?? 4) - (rank[b.severity ?? ""] ?? 4) || end(a) - end(b));
}
