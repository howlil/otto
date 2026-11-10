import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SHOULDER_PX, notchGutter, notchShape } from "../src/features/shell/placement.ts";
import {
  confirmedPlacementPreference,
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

describe("Notch placement geometry", () => {
  test("the silhouette follows the requested placement and presentation", () => {
    expect(notchShape("floating", false)).toBe("capsule");
    expect(notchShape("floating", true)).toBe("card");
    expect(notchShape("attached", false)).toBe("attached");
    expect(notchShape("attached", true)).toBe("attached");
  });

  test("only the attached silhouette reserves shoulder space", () => {
    expect(SHOULDER_PX).toBe(12);
    expect(notchGutter("attached")).toBe(12);
    expect(notchGutter("capsule")).toBe(0);
    expect(notchGutter("card")).toBe(0);
  });

  test("native geometry tokens match the stylesheet the UI renders with", () => {
    const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
    expect(css).toContain("--otto-shoulder: 12px;");
    expect(css).toContain("--radius-otto-attached: 18px;");
    expect(css).toContain("--radius-otto-expanded: 18px;");
  });
});

describe("Placement preference authority", () => {
  test("attached is a persisted placement while unknown values fall back", () => {
    expect(readSaved(JSON.stringify({ placement: "attached" })).placement).toBe("attached");
    expect(readSaved(JSON.stringify({ placement: "floating" })).placement).toBe("floating");
    expect(readSaved(JSON.stringify({ placement: "top" })).placement).toBe("floating");
    expect(readSaved(JSON.stringify({ placement: 3 })).placement).toBe("floating");
    expect(readSaved(JSON.stringify({ expression: "happy" })).placement).toBe("floating");
  });

  test("generic settings updates cannot move the native window placement", () => {
    const merged = mergePreferences(defaults, { placement: "attached", clickOutside: false });
    expect(merged.placement).toBe("floating");
    expect(merged.clickOutside).toBe(false);
  });

  test("only an observed native placement reconciles the stored preference", () => {
    expect(confirmedPlacementPreference(defaults, "attached").placement).toBe("attached");
    expect(confirmedPlacementPreference(defaults, "floating").placement).toBe("floating");
    expect(confirmedPlacementPreference(defaults, null)).toBe(defaults);
    const attached = { ...defaults, placement: "attached" };
    expect(confirmedPlacementPreference(attached, "floating").placement).toBe("floating");
  });
});
