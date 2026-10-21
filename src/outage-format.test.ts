import { describe, expect, it } from "vitest";
import { outageStatus, plural } from "./outage-format";

const now = new Date("2026-10-21T11:00:00Z");
const base = { updated: "2026-10-21T10:52:00Z", customers_out: 2339, counties: 62, utilities: 157, utilities_ok: 155 };

describe("outageStatus", () => {
  it("sums up the reported outages", () => {
    expect(outageStatus(base, now)).toBe("2,339 customers out in 62 counties, from 155 of 157 reporting utilities. Updated 8 min ago.");
  });

  it("says when nothing is out", () => {
    expect(outageStatus({ ...base, customers_out: 0, counties: 0 }, now)).toMatch(/^No reported outages, from 155 of 157/);
  });

  it("uses the singular for one", () => {
    expect(plural(1, "county", "counties")).toBe("1 county");
    expect(plural(1200, "customer", "customers")).toBe("1,200 customers");
  });
});
