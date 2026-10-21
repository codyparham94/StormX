import { describe, expect, it } from "vitest";
import { simStatus } from "./sim-format";

const base = { updated: "", utility: "StormX Demo Electric", customers: 58589, customers_out: 2975, feeders: 30, feeders_out: 4, tickets_open: 5 };

describe("simStatus", () => {
  it("always says simulated", () => {
    expect(simStatus(base)).toBe("StormX Demo Electric (simulated): 2,975 of 58,589 customers out, 5 open tickets.");
    expect(simStatus({ ...base, customers_out: 0, tickets_open: 1 })).toBe("StormX Demo Electric (simulated): all 58,589 customers on, 1 open ticket.");
  });
});
