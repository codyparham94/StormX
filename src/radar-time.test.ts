import { describe, expect, it } from "vitest";
import { lastStop, serviceWindow } from "./radar-time";

describe("lastStop", () => {
  const start = Date.UTC(2026, 9, 20, 12, 0);
  it("snaps to the 5-minute grid from the window start", () => {
    expect(lastStop(start, start + 17 * 60_000)).toBe(start + 15 * 60_000);
    expect(lastStop(start, start + 20 * 60_000)).toBe(start + 20 * 60_000);
    expect(lastStop(start, start + 60_000)).toBe(start);
  });
});

describe("serviceWindow", () => {
  it("reads the ImageServer time extent", () => {
    expect(serviceWindow({ timeInfo: { timeExtent: [1, 2] } })).toEqual([1, 2]);
  });
  it("rejects missing or empty extents", () => {
    expect(serviceWindow({})).toBeNull();
    expect(serviceWindow({ timeInfo: { timeExtent: [5, 5] } })).toBeNull();
  });
});
