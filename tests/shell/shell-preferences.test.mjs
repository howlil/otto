import { describe, expect, test } from "bun:test";
import {
  confirmedCapturePreference,
  defaults,
  mergePreferences,
  readPreferences,
  surfaceOpacityPercent,
} from "../../src/features/shell/model/preferences";

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
    const result = readSaved(JSON.stringify({ clickOutside: false }));
    expect(result.clickOutside).toBe(false);
    expect(result.hideFromCapture).toBe(true);
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
  test("background defaults to solid and validates manual transparency bounds", () => {
    expect(defaults.backgroundStyle).toBe("solid");
    expect(defaults.backgroundOpacity).toBe(78);
    expect(surfaceOpacityPercent(defaults)).toBe(100);

    const transparent = readSaved(
      JSON.stringify({ backgroundStyle: "transparent", backgroundOpacity: 62 }),
    );
    expect(transparent.backgroundStyle).toBe("transparent");
    expect(transparent.backgroundOpacity).toBe(62);
    expect(surfaceOpacityPercent(transparent)).toBe(62);

    const invalid = readSaved(
      JSON.stringify({ backgroundStyle: "glass", backgroundOpacity: 15 }),
    );
    expect(invalid.backgroundStyle).toBe("solid");
    expect(invalid.backgroundOpacity).toBe(78);

    const fractional = readSaved(
      JSON.stringify({ backgroundStyle: "transparent", backgroundOpacity: 72.5 }),
    );
    expect(fractional.backgroundStyle).toBe("transparent");
    expect(fractional.backgroundOpacity).toBe(78);
    expect(surfaceOpacityPercent({ backgroundStyle: "transparent", backgroundOpacity: 12 })).toBe(
      30,
    );
    expect(surfaceOpacityPercent({ backgroundStyle: "transparent", backgroundOpacity: 99 })).toBe(
      95,
    );
  });
  test("compact style defaults to capsule and validates saved circle preference", () => {
    expect(defaults.compactStyle).toBe("capsule");
    expect(readSaved(JSON.stringify({ compactStyle: "circle" })).compactStyle).toBe("circle");
    expect(readSaved(JSON.stringify({ compactStyle: "capsule" })).compactStyle).toBe("capsule");
    expect(readSaved(JSON.stringify({ compactStyle: "mascot" })).compactStyle).toBe("capsule");
    expect(readSaved(JSON.stringify({ compactStyle: 42 })).compactStyle).toBe("capsule");
  });
});
