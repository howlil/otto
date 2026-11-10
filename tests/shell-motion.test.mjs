import { describe, expect, test } from "bun:test";
import {
  isContentResize,
  measuredNotchHeight,
  morphDuration,
  morphMilliseconds,
  shouldAnimateNotch,
  updateMeasuredHeights,
} from "../src/features/shell/motion.ts";

const current = { surface: "agentFull", height: 264 };

describe("native notch motion policy", () => {
  test("animates changes in content height without treating them as a new page", () => {
    const next = { ...current, height: 312 };
    expect(shouldAnimateNotch(current, next, false)).toBe(true);
    expect(isContentResize(current, next)).toBe(true);
    expect(isContentResize(current, { ...current, surface: "agentSettings" })).toBe(false);
  });

  test("snaps the first measured height for a surface instead of animating a second morph", () => {
    const measured = { surface: "agentReady", height: 240 };
    expect(shouldAnimateNotch({ surface: "agentReady", height: undefined }, measured, false)).toBe(
      false,
    );
    expect(isContentResize({ surface: "agentReady", height: undefined }, measured)).toBe(false);
  });

  test("does not animate initial layout or identical geometry, and honors reduced motion", () => {
    expect(shouldAnimateNotch(null, current, false)).toBe(false);
    expect(shouldAnimateNotch(current, { ...current }, false)).toBe(false);
    expect(shouldAnimateNotch(current, { ...current, height: 300 }, true)).toBe(false);
  });

  test("treats an actual surface change as a page morph", () => {
    expect(shouldAnimateNotch(current, { ...current, surface: "home" }, false)).toBe(true);
  });

  test("derives one morph duration from the motion profile for css and the native warp", () => {
    expect(morphDuration("fluid")).toBe(420);
    expect(morphDuration("gentle")).toBe(300);
    expect(morphDuration("reduced")).toBe(0);
    expect(morphMilliseconds("gentle")).toBe("300ms");
  });

  test("measurement noise cannot inflate padding while real growth remains visible", () => {
    const stable = updateMeasuredHeights({}, "agent", 303.9);
    expect(stable.agent).toBe(304);
    expect(updateMeasuredHeights(stable, "agent", 304.1)).toBe(stable);
    expect(updateMeasuredHeights(stable, "agent", 305)).toEqual({ agent: 305 });
    expect(measuredNotchHeight(170)).toBe(170);
    expect(measuredNotchHeight(171)).toBe(171);
    expect(measuredNotchHeight(179)).toBe(179);
    expect(measuredNotchHeight(900)).toBe(610);
    expect(measuredNotchHeight(Number.NaN)).toBe(170);
  });

  test("retains separate layout measurements across Agent and Settings", () => {
    const agent = updateMeasuredHeights({}, "agent", 170);
    const settings = updateMeasuredHeights(agent, "agent-settings", 346);
    expect(settings.agent).toBe(170);
    expect(settings["agent-settings"]).toBe(346);
    expect(updateMeasuredHeights(settings, "agent", 170.1)).toBe(settings);
  });
});
