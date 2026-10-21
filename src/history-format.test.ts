import { describe, expect, it } from "vitest";
import { daysBetween, eventLabel, focusCounties, monthsFor, nationalTotals, peaksForWindow, replayCounties, toRings, windowFrom, type CountyFeature } from "./history-format";

describe("windows", () => {
  it("lists days across a month end and caps the length", () => {
    expect(daysBetween("2021-02-27", "2021-03-02")).toEqual(["2021-02-27", "2021-02-28", "2021-03-01", "2021-03-02"]);
    expect(daysBetween("2021-01-01", "2021-12-31")).toHaveLength(14);
  });

  it("keeps a date window inside the data", () => {
    expect(windowFrom("2010-05-01", 3)).toEqual(["2014-11-01", "2014-11-02", "2014-11-03"]);
    expect(windowFrom("2025-12-30", 10)).toEqual(["2025-12-30", "2025-12-31"]);
    expect(monthsFor(windowFrom("2021-02-25", 10))).toEqual(["2021-02", "2021-03"]);
  });
});

describe("replay data", () => {
  const feb = { days: ["2021-02-27", "2021-02-28"], national: [100, 900], peak: { "48201": [10, 20], "22071": [0, 5] } };
  const mar = { days: ["2021-03-01"], national: [40], peak: { "48201": [3] } };
  const peaks = peaksForWindow(["2021-02-28", "2021-03-01"], [feb, mar]);

  it("picks each county's peaks for the window's days", () => {
    expect(Object.fromEntries(peaks)).toEqual({ "48201": [20, 3], "22071": [5, 0] });
    expect(nationalTotals(["2021-02-28", "2021-03-01"], [feb, mar])).toEqual([900, 40]);
  });

  it("keeps only the counties hit, with a field per day", () => {
    const square = [[[0, 0], [1, 0], [1, 1], [0, 0]]];
    const county = (fips: string): CountyFeature => ({ type: "Feature", geometry: { type: "Polygon", coordinates: square }, properties: { fips, name: fips, state: "TX", customers: 100 } });
    const counties = replayCounties([county("01001"), county("48201")], peaks);
    expect(counties).toHaveLength(1);
    expect(counties[0].attributes).toMatchObject({ oid: 2, fips: "48201", d0: 20, d1: 3 });
    expect(counties[0].rings).toEqual(square);
  });

  it("flattens multipolygons into rings", () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(toRings({ type: "MultiPolygon", coordinates: [[ring], [ring, ring]] })).toHaveLength(3);
    expect(toRings(null)).toEqual([]);
  });
});

it("labels an event", () => {
  const event = { start: "2021-02-14", end: "2021-02-20", peak_day: "2021-02-16", peak: 4_612_345, states: ["Texas", "Louisiana"] };
  expect(eventLabel(event)).toBe("Feb 14 to 20, 2021: Texas, Louisiana (4.6M out at peak)");
  expect(eventLabel({ ...event, end: "2021-03-02" })).toMatch(/^Feb 14 to Mar 2, 2021:/);
});

describe("focusCounties", () => {
  it("frames the worst-hit counties and drops far-off spikes", () => {
    const counties = [
      { out: 500, center: [-82, 34] }, // South Carolina
      { out: 400, center: [-83, 33] }, // Georgia
      { out: 5, center: [-100, 40] }, // background
      { out: 150, center: [-66, 18] }, // Puerto Rico
      { out: 100, center: [-120, 37] }, // California
      { out: 0, center: [-90, 30] },
    ];
    expect(focusCounties(counties).sort()).toEqual([0, 1]);
  });
});
