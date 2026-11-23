import { describe, expect, test } from "bun:test";
import {
  confirmedCapturePreference,
  defaults,
  mergePreferences,
  readPreferences,
  surfaceOpacityPercent,
} from "../../src/features/shell/model/preferences";
import {
  buildOttoLogoSvg,
  defaultLogoConfig,
  normalizeLogoConfig,
  sanitizeCustomLogoSvg,
} from "../../src/shared/ui";

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
  test("background defaults to solid, supports blur and liquid-glass, and migrates legacy transparent", () => {
    expect(defaults.backgroundStyle).toBe("solid");
    expect(defaults.backgroundOpacity).toBe(78);
    expect(surfaceOpacityPercent(defaults)).toBe(100);

    const blur = readSaved(
      JSON.stringify({ backgroundStyle: "blur", backgroundOpacity: 62 }),
    );
    expect(blur.backgroundStyle).toBe("blur");
    expect(blur.backgroundOpacity).toBe(62);
    expect(surfaceOpacityPercent(blur)).toBe(62);

    const liquidGlass = readSaved(
      JSON.stringify({ backgroundStyle: "liquid-glass", backgroundOpacity: 68 }),
    );
    expect(liquidGlass.backgroundStyle).toBe("liquid-glass");
    expect(liquidGlass.backgroundOpacity).toBe(68);
    expect(surfaceOpacityPercent(liquidGlass)).toBe(68);

    const legacyTransparent = readSaved(
      JSON.stringify({ backgroundStyle: "transparent", backgroundOpacity: 64 }),
    );
    expect(legacyTransparent.backgroundStyle).toBe("blur");
    expect(legacyTransparent.backgroundOpacity).toBe(64);
    expect(surfaceOpacityPercent(legacyTransparent)).toBe(64);

    const invalid = readSaved(
      JSON.stringify({ backgroundStyle: "glass", backgroundOpacity: 15 }),
    );
    expect(invalid.backgroundStyle).toBe("solid");
    expect(invalid.backgroundOpacity).toBe(78);

    const fractional = readSaved(
      JSON.stringify({ backgroundStyle: "blur", backgroundOpacity: 72.5 }),
    );
    expect(fractional.backgroundStyle).toBe("blur");
    expect(fractional.backgroundOpacity).toBe(78);
    expect(surfaceOpacityPercent({ backgroundStyle: "blur", backgroundOpacity: 12 })).toBe(30);
    expect(surfaceOpacityPercent({ backgroundStyle: "liquid-glass", backgroundOpacity: 99 })).toBe(
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
  test("dockWithOttoOs defaults on and anchored custom positions validate cleanly", () => {
    expect(defaults.dockWithOttoOs).toBe(true);
    expect(readSaved(JSON.stringify({ dockWithOttoOs: false })).dockWithOttoOs).toBe(false);
    expect(readSaved(JSON.stringify({ dockWithOttoOs: "no" })).dockWithOttoOs).toBe(true);
    expect(
      readSaved(
        JSON.stringify({
          position: { x: 1350, y: 400, anchorX: "right", anchorY: "bottom", height: 610 },
        }),
      ).position,
    ).toEqual({ x: 1350, y: 400, anchorX: "right", anchorY: "bottom", height: 610 });
    expect(
      readSaved(JSON.stringify({ position: { x: 100, y: 200, anchorX: "middle" } })).position,
    ).toBeNull();
    expect(
      readSaved(JSON.stringify({ position: { x: 100, y: 200, anchorY: "middle" } })).position,
    ).toBeNull();
  });
  test("logo customizer normalizes shapes, colors, proportions, and extracts clean SVG", () => {
    const custom = normalizeLogoConfig({
      shape: "hexagon",
      eyeStyle: "spark",
      badgeTone: "emerald",
      eyeTone: "sky",
      eyeScale: 120,
      eyeGap: 10,
      glow: true,
    });
    expect(custom.shape).toBe("hexagon");
    expect(custom.eyeStyle).toBe("spark");
    expect(custom.badgeTone).toBe("emerald");
    expect(custom.eyeTone).toBe("sky");
    expect(custom.eyeScale).toBe(120);
    expect(custom.eyeGap).toBe(10);
    expect(custom.glow).toBe(true);

    const svg = buildOttoLogoSvg(custom);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<polygon");
    expect(svg).toContain("otto-eye-glow");
    expect(svg).toContain("rgb(20, 44, 37)");
    expect(svg).toContain("rgb(159, 188, 216)");

    const defaultSvg = buildOttoLogoSvg(defaultLogoConfig);
    expect(defaultSvg).toContain("rx=\"18\"");
    expect(defaultSvg).toContain("rgb(244, 244, 244)");

    expect(sanitizeCustomLogoSvg("<svg><script>alert(1)</script></svg>")).toBeNull();
    expect(sanitizeCustomLogoSvg("<svg onload=\"alert(1)\"></svg>")).toBeNull();
    const cleanSvg = sanitizeCustomLogoSvg("  <svg viewBox=\"0 0 32 32\"><circle cx=\"16\" cy=\"16\" r=\"12\"/></svg> ");
    expect(cleanSvg).toBe("<svg viewBox=\"0 0 32 32\"><circle cx=\"16\" cy=\"16\" r=\"12\"/></svg>");
    expect(buildOttoLogoSvg({ ...defaultLogoConfig, customSvg: cleanSvg })).toBe(cleanSvg);
  });
});
