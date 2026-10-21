/** The live outage risk index: the risk ETL's files, and the text and shapes built from them. */
import { ago } from "./forecast-format";
import { plural } from "./outage-format";

/** Magma steps, which stay in order for colorblind visitors and don't borrow the outage colors. */
export const RISK_LEVELS = [
  { name: "Low", min: 0, max: 15, color: [252, 253, 191] },
  { name: "Elevated", min: 15, max: 30, color: [254, 176, 120] },
  { name: "High", min: 30, max: 50, color: [241, 96, 93] },
  { name: "Very high", min: 50, max: 70, color: [183, 55, 121] },
  { name: "Extreme", min: 70, max: 101, color: [81, 18, 124] },
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number]["name"];

/** risk/summary.json, written by the risk ETL every hour. */
export interface RiskSummary {
  updated: string;
  sources: Record<string, { ok: boolean; cells?: number; error?: string }>;
  cells: Record<RiskLevel, number>;
  counties: Record<RiskLevel, number>;
  customers_affected: number;
  top: { fips: string; name: string; state: string; risk: number; level: RiskLevel; driver: string; customers_affected: number }[];
}

/** risk/h3-res6.json: one row per hex, in `meta.columns` order, with `driver` an index into `meta.drivers`. */
export interface RiskCells {
  meta: { updated: string; res: number; columns: string[]; drivers: string[] };
  cells: (string | number)[][];
}

export interface RiskCell {
  cell: string;
  risk: number;
  level: RiskLevel;
  hazard: number;
  driver: string;
  exposure: number;
  vulnerability: number;
  line_km: number;
  substations: number;
  customers: number;
  customers_affected: number;
  fips: string;
}

export function riskLevel(risk: number): RiskLevel {
  return [...RISK_LEVELS].reverse().find((l) => risk >= l.min)?.name ?? "Low";
}

export function riskRows(file: RiskCells): RiskCell[] {
  const at = Object.fromEntries(file.meta.columns.map((name, i) => [name, i]));
  return file.cells.map((row) => {
    const n = (name: string) => Number(row[at[name]]) || 0;
    return {
      cell: String(row[at.cell]),
      risk: n("risk"),
      level: riskLevel(n("risk")),
      hazard: n("hazard"),
      driver: file.meta.drivers[n("driver")] ?? "",
      exposure: n("exposure"),
      vulnerability: n("vulnerability"),
      line_km: n("line_km"),
      substations: n("substations"),
      customers: n("customers"),
      customers_affected: n("customers_affected"),
      fips: String(row[at.fips] ?? ""),
    };
  });
}

/** Two significant figures, since customers affected is a rough estimate. */
export function roughly(n: number): string {
  if (n < 100) return String(Math.round(n));
  const step = 10 ** (Math.floor(Math.log10(n)) - 1);
  return new Intl.NumberFormat("en-US").format(Math.round(n / step) * step);
}

export function missingSources(summary: RiskSummary): string[] {
  return Object.entries(summary.sources)
    .filter(([, s]) => !s.ok)
    .map(([name]) => name);
}

export function riskStatus(summary: RiskSummary, now = new Date()): string {
  const updated = `Updated ${ago(new Date(summary.updated), now)}.`;
  const missing = missingSources(summary);
  const gaps = missing.length ? ` Missing: ${missing.join(", ")}.` : "";
  const elevated = (["Elevated", "High", "Very high", "Extreme"] as const).reduce((sum, l) => sum + (summary.counties[l] ?? 0), 0);
  const top = summary.top[0];
  if (!elevated || !top) return `No elevated outage risk in today's forecasts and warnings. ${updated}${gaps}`;
  return (
    `Highest outage risk: ${top.level} in ${top.name}, ${top.state} (${top.driver}). ` +
    `${plural(elevated, "county is", "counties are")} at Elevated or above, and roughly ${roughly(summary.customers_affected)} customers could lose power. ` +
    `${updated}${gaps}`
  );
}

type Ring = number[][];

/** An H3 boundary from h3-js ([lng, lat], counterclockwise) as a closed, clockwise ArcGIS ring. */
export function hexRing(boundary: number[][]): Ring | null {
  const lons = boundary.map((p) => p[0]);
  // Cells across the antimeridian (the far Aleutians) would draw the long way round the globe.
  if (Math.max(...lons) - Math.min(...lons) > 180) return null;
  const ring = boundary.map((p) => [p[0], p[1]]);
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  // Shoelace: positive means counterclockwise with y up.
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return area > 0 ? ring.reverse() : ring;
}
