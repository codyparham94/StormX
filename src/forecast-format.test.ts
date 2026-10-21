import { describe, expect, it } from "vitest";
import { ago, celsiusToF, hourLabel, kmhToMph, parseZip, pointsPath, sortAlerts } from "./forecast-format";

describe("parseZip", () => {
  it("accepts 5-digit and ZIP+4 codes", () => {
    expect(parseZip("70112")).toBe("70112");
    expect(parseZip(" 37040-1234 ")).toBe("37040");
    expect(parseZip("00601")).toBe("00601");
  });
  it("rejects anything else", () => {
    for (const bad of ["", "7011", "701123", "abcde", "70112-12"]) expect(parseZip(bad)).toBeNull();
  });
});

describe("pointsPath", () => {
  it("rounds to four decimals", () => {
    expect(pointsPath(29.957294, -90.077004)).toBe("/points/29.9573,-90.077");
  });
});

describe("unit conversions", () => {
  it("converts and handles missing readings", () => {
    expect(celsiusToF(0)).toBe(32);
    expect(celsiusToF(21.1)).toBe(70);
    expect(celsiusToF(null)).toBeNull();
    expect(kmhToMph(16.09344)).toBe(10);
    expect(kmhToMph(undefined)).toBeNull();
  });
});

describe("time labels", () => {
  it("formats the hour in the point's zone", () => {
    expect(hourLabel("2026-10-20T20:00:00Z", "America/Chicago")).toBe("3 PM");
  });
  it("says how long ago", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(ago(new Date("2026-10-20T11:59:45Z"), now)).toBe("just now");
    expect(ago(new Date("2026-10-20T11:48:00Z"), now)).toBe("12 min ago");
    expect(ago(new Date("2026-10-20T09:00:00Z"), now)).toBe("3 hr ago");
  });
});

describe("sortAlerts", () => {
  it("puts the most severe and soonest-ending first", () => {
    const sorted = sortAlerts([
      { id: "minor", severity: "Minor", ends: "2026-10-20T10:00:00Z" },
      { id: "severe-late", severity: "Severe", ends: "2026-10-21T10:00:00Z" },
      { id: "severe-soon", severity: "Severe", ends: "2026-10-20T10:00:00Z" },
      { id: "none" },
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["severe-soon", "severe-late", "minor", "none"]);
  });
});
