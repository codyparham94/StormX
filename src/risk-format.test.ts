import { describe, expect, it } from "vitest";
import { hexRing, missingSources, riskLevel, riskRows, riskStatus, roughly, type RiskSummary } from "./risk-format";

const now = new Date("2026-10-21T16:00:00Z");
const levels = { Extreme: 0, "Very high": 1, High: 4, Elevated: 20, Low: 230 };
const summary: RiskSummary = {
  updated: "2026-10-21T15:48:00Z",
  sources: { "SPC outlook": { ok: true, cells: 41805 }, "NWS alerts": { ok: true, cells: 14208 } },
  cells: levels,
  counties: levels,
  customers_affected: 329_342,
  top: [{ fips: "04025", name: "Yavapai", state: "AZ", risk: 66, level: "Very high", driver: "NWS: Tornado Warning", customers_affected: 15414 }],
};

describe("riskLevel", () => {
  it("uses the ETL's breaks", () => {
    expect([0, 14, 15, 29, 30, 50, 69, 70, 100].map(riskLevel)).toEqual(["Low", "Low", "Elevated", "Elevated", "High", "Very high", "Very high", "Extreme", "Extreme"]);
  });
});

describe("riskRows", () => {
  it("names each column and looks up the driver", () => {
    const rows = riskRows({
      meta: {
        updated: "",
        res: 6,
        columns: ["cell", "risk", "hazard", "driver", "exposure", "vulnerability", "line_km", "substations", "customers", "customers_affected", "fips"],
        drivers: ["SPC: general thunderstorms", "NWS: Tornado Warning"],
      },
      cells: [["8626c1a07ffffff", 54, 0.6, 1, 1, 0.53, 20, 2, 5000, 875, "40109"]],
    });
    expect(rows).toEqual([
      {
        cell: "8626c1a07ffffff",
        risk: 54,
        level: "Very high",
        hazard: 0.6,
        driver: "NWS: Tornado Warning",
        exposure: 1,
        vulnerability: 0.53,
        line_km: 20,
        substations: 2,
        customers: 5000,
        customers_affected: 875,
        fips: "40109",
      },
    ]);
  });
});

describe("riskStatus", () => {
  it("leads with the worst county", () => {
    expect(riskStatus(summary, now)).toBe(
      "Highest outage risk: Very high in Yavapai, AZ (NWS: Tornado Warning). 25 counties are at Elevated or above, and roughly 330,000 customers could lose power. Updated 12 min ago.",
    );
  });

  it("says when nothing is elevated, and names missing feeds", () => {
    const quiet = { ...summary, counties: { ...levels, "Very high": 0, High: 0, Elevated: 0 }, sources: { ...summary.sources, "NWS alerts": { ok: false, error: "timed out" } } };
    expect(riskStatus(quiet, now)).toBe("No elevated outage risk in today's forecasts and warnings. Updated 12 min ago. Missing: NWS alerts.");
    expect(missingSources(quiet)).toEqual(["NWS alerts"]);
  });

  it("rounds estimates to two figures", () => {
    expect([7, 149, 1_234, 98_765, 329_342].map(roughly)).toEqual(["7", "150", "1,200", "99,000", "330,000"]);
  });
});

describe("hexRing", () => {
  it("closes the ring and turns it clockwise", () => {
    const ccw = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(hexRing(ccw)).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
  });

  it("drops cells across the antimeridian", () => {
    expect(
      hexRing([
        [179.9, 52],
        [-179.9, 52],
        [-179.9, 52.1],
        [179.9, 52.1],
      ]),
    ).toBeNull();
  });
});
