/** Text for the simulated utility, kept apart from the map so it can be tested. */

export const SIM_NOTE = "Simulated data. StormX Demo Electric is a fictional utility made up for this demo.";

/** sim/summary.json, written with the risk index every hour. */
export interface SimSummary {
  updated: string;
  utility: string;
  customers: number;
  customers_out: number;
  feeders: number;
  feeders_out: number;
  tickets_open: number;
}

const count = new Intl.NumberFormat("en-US");

export function simStatus(summary: SimSummary): string {
  const out = summary.customers_out
    ? `${count.format(summary.customers_out)} of ${count.format(summary.customers)} customers out`
    : `all ${count.format(summary.customers)} customers on`;
  const tickets = summary.tickets_open === 1 ? "1 open ticket" : `${summary.tickets_open} open tickets`;
  return `${summary.utility} (simulated): ${out}, ${tickets}.`;
}
