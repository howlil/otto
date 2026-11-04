import { describe, expect, test } from "bun:test";
import {
  confirmedCapturePreference,
  defaults,
  mergePreferences,
  readPreferences,
} from "../src/features/shell/preferences.ts";

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
    expect(defaults.osEventsEnabled).toBe(true);
    expect(defaults.clickOutside).toBe(true);
  });
  test("legacy values preserve behavior when the capture flag is absent", () => {
    const result = readSaved(JSON.stringify({ clickOutside: false, expression: "happy" }));
    expect(result.clickOutside).toBe(false);
    expect(result.expression).toBe("happy");
    expect(result.hideFromCapture).toBe(true);
    expect(result.osEventsEnabled).toBe(true);
  });
  test("explicit capture opt-out coexists with Keep Expanded", () => {
    const result = readSaved(JSON.stringify({ hideFromCapture: false, clickOutside: false }));
    expect(result.hideFromCapture).toBe(false);
    expect(result.clickOutside).toBe(false);
  });
  test("generic settings updates cannot bypass native capture confirmation", () => {
    const current = { ...defaults, hideFromCapture: false };
    const merged = mergePreferences(current, { hideFromCapture: true, clickOutside: false });
    expect(merged.hideFromCapture).toBe(false);
    expect(merged.clickOutside).toBe(false);
    expect(mergePreferences(defaults, { hideFromCapture: false }).hideFromCapture).toBe(true);
  });
  test("only an observed native state can reconcile stored capture settings", () => {
    const disabled = { ...defaults, hideFromCapture: false };
    expect(confirmedCapturePreference(disabled, true).hideFromCapture).toBe(true);
    expect(confirmedCapturePreference(defaults, false).hideFromCapture).toBe(false);
    expect(confirmedCapturePreference(disabled, null)).toBe(disabled);
  });
  test("invalid and corrupt values cannot silently disable protection", () => {
    expect(readSaved("not-json")).toEqual(defaults);
    const result = readSaved(JSON.stringify({ hideFromCapture: "false", clickOutside: "false" }));
    expect(result.hideFromCapture).toBe(true);
    expect(result.clickOutside).toBe(true);
  });
  test("OS event preference accepts an explicit opt-out and rejects invalid values", () => {
    expect(readSaved(JSON.stringify({ osEventsEnabled: false })).osEventsEnabled).toBe(false);
    expect(readSaved(JSON.stringify({ osEventsEnabled: "false" })).osEventsEnabled).toBe(true);
  });
});
