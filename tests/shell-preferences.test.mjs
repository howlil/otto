import { describe, expect, test } from "bun:test";
import { defaults, readPreferences } from "../src/features/shell/preferences.ts";

function readSaved(raw) {
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => raw };
  try {
    return readPreferences();
  } finally {
    globalThis.localStorage = original;
  }
}

describe("Shell preferences compatibility", () => {
  test("capture protection defaults on and pinned blur auto-closes", () => {
    expect(readSaved(null)).toEqual(defaults);
    expect(defaults.hideFromCapture).toBe(true);
    expect(defaults.clickOutside).toBe(true);
  });
  test("legacy values preserve behavior when the capture flag is absent", () => {
    const result = readSaved(JSON.stringify({ clickOutside: false, expression: "happy" }));
    expect(result.clickOutside).toBe(false);
    expect(result.expression).toBe("happy");
    expect(result.hideFromCapture).toBe(true);
  });
  test("explicit capture opt-out coexists with Keep Expanded", () => {
    const result = readSaved(JSON.stringify({ hideFromCapture: false, clickOutside: false }));
    expect(result.hideFromCapture).toBe(false);
    expect(result.clickOutside).toBe(false);
  });
  test("invalid and corrupt values cannot silently disable protection", () => {
    expect(readSaved("not-json")).toEqual(defaults);
    const result = readSaved(JSON.stringify({ hideFromCapture: "false", clickOutside: "false" }));
    expect(result.hideFromCapture).toBe(true);
    expect(result.clickOutside).toBe(true);
  });
});
