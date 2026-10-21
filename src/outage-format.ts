/** Text for the Outage risk mode card, kept apart from the map so it can be tested. */
import { ago } from "./forecast-format";

/** live/outages/summary.json, written by the ODIN ETL every 15 minutes. */
export interface OutageSummary {
  updated: string;
  customers_out: number;
  counties: number;
  utilities: number;
  utilities_ok: number;
}

const count = new Intl.NumberFormat("en-US");

export function plural(n: number, one: string, many: string): string {
  return `${count.format(n)} ${n === 1 ? one : many}`;
}

export function outageStatus(summary: OutageSummary, now = new Date()): string {
  const out =
    summary.customers_out > 0
      ? `${plural(summary.customers_out, "customer", "customers")} out in ${plural(summary.counties, "county", "counties")}`
      : "No reported outages";
  return `${out}, from ${summary.utilities_ok} of ${summary.utilities} reporting utilities. Updated ${ago(new Date(summary.updated), now)}.`;
}
