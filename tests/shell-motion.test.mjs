import { describe, expect, test } from "bun:test";
import { measuredNotchHeight, shouldAnimateNotch, updateMeasuredHeights } from "../src/features/shell/motion.ts";

const current = { surface: "agentFull", height: 264 };

describe("native notch motion intent", () => {
  test("animates measured content growth even when the surface identity stays the same", () => {
    expect(shouldAnimateNotch(current, { ...current, height: 312 }, false)).toBe(true);
  });

  test("does not animate initial geometry, unchanged dimensions or reduced motion", () => {
    expect(shouldAnimateNotch(null, current, false)).toBe(false);
    expect(shouldAnimateNotch(current, { ...current }, false)).toBe(false);
    expect(shouldAnimateNotch(current, { ...current, height: 300 }, true)).toBe(false);
  });

  test("animates a page change and does not mistake a repeated surface for a new morph", () => {
    expect(shouldAnimateNotch(current, { ...current, surface: "home" }, false)).toBe(true);
    expect(shouldAnimateNotch(current, current, false)).toBe(false);
  });

  test("coalesces small measurement changes upward without exceeding native bounds", () => {
    expect(measuredNotchHeight(170)).toBe(176);
    expect(measuredNotchHeight(171)).toBe(176);
    expect(measuredNotchHeight(179)).toBe(184);
    expect(measuredNotchHeight(900)).toBe(610);
    expect(measuredNotchHeight(Number.NaN)).toBe(170);
  });

  test("retains measured height for each page across Agent and Settings navigation", () => {
    const agent = updateMeasuredHeights({}, "agent", 170);
    const settings = updateMeasuredHeights(agent, "agent-settings", 346);
    expect(settings.agent).toBe(176);
    expect(settings["agent-settings"]).toBe(352);
    expect(updateMeasuredHeights(settings, "agent", 171)).toBe(settings);
  });
});
