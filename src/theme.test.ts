import { describe, expect, it } from "vitest";
import { resolveDark } from "./theme";

describe("resolveDark", () => {
  it("follows the device until the visitor chooses", () => {
    expect(resolveDark(null, true)).toBe(true);
    expect(resolveDark(null, false)).toBe(false);
  });

  it("keeps an explicit choice whatever the device says", () => {
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
  });
});
