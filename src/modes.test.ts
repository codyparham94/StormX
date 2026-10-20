import { describe, expect, it } from "vitest";
import { lastMode, parseRoute, rememberMode, routeHash } from "./modes";

describe("parseRoute", () => {
  it("opens the landing page for an empty or unknown hash", () => {
    expect(parseRoute("")).toEqual({ screen: "landing" });
    expect(parseRoute("#/")).toEqual({ screen: "landing" });
    expect(parseRoute("#/nowhere")).toEqual({ screen: "landing" });
  });

  it("reads both map modes, with or without the slash and extra parts", () => {
    expect(parseRoute("#/radar")).toEqual({ screen: "map", mode: "radar" });
    expect(parseRoute("#outage")).toEqual({ screen: "map", mode: "outage" });
    expect(parseRoute("#/outage/-91.5,30.3,6")).toEqual({ screen: "map", mode: "outage" });
    expect(parseRoute("#/radar?t=1")).toEqual({ screen: "map", mode: "radar" });
  });

  it("round-trips through routeHash", () => {
    for (const hash of ["#/", "#/radar", "#/outage"]) expect(routeHash(parseRoute(hash))).toBe(hash);
  });
});

describe("lastMode", () => {
  it("keeps only a valid mode", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) };
    expect(lastMode(storage)).toBeNull();
    rememberMode("outage", storage);
    expect(lastMode(storage)).toBe("outage");
    values.set("stormx-mode", "bogus");
    expect(lastMode(storage)).toBeNull();
  });

  it("survives storage that throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(lastMode(blocked)).toBeNull();
    expect(() => rememberMode("radar", blocked)).not.toThrow();
  });
});
