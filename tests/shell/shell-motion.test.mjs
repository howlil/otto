import { describe, expect, test } from "bun:test";
import {
  isContentResize,
  measuredNotchHeight,
  morphDuration,
  morphMilliseconds,
  retargetDuration,
  shouldAnimateNotch,
  updateMeasuredHeights,
} from "../../src/features/shell/model/motion";

const current = { surface: "agentFull", height: 264 };

describe("native notch motion policy", () => {
  test("animates changes in content height without treating them as a new page", () => {
    const next = { ...current, height: 312 };
    expect(shouldAnimateNotch(current, next, false)).toBe(true);
    expect(isContentResize(current, next)).toBe(true);
    expect(isContentResize(current, { ...current, surface: "settings" })).toBe(false);
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
    expect(shouldAnimateNotch(current, { ...current, surface: "settings" }, false)).toBe(true);
  });

  test("a height change during a running morph finishes with it instead of starting a short second morph", () => {
    const base = { animate: true, durationMs: 260, heightOnly: true };
    expect(retargetDuration({ ...base, remainingMs: 210 })).toBe(210);
    expect(retargetDuration({ ...base, remainingMs: 40 })).toBe(120);
    expect(retargetDuration({ ...base, remainingMs: 0 })).toBe(170);
    expect(retargetDuration({ ...base, remainingMs: 210, heightOnly: false })).toBe(260);
    expect(retargetDuration({ ...base, remainingMs: 210, animate: false })).toBe(0);
    expect(
      retargetDuration({
        animate: false,
        durationMs: 260,
        remainingMs: 220,
        heightOnly: false,
        firstMeasurement: true,
      }),
    ).toBe(220);
    expect(
      retargetDuration({
        animate: false,
        durationMs: 260,
        remainingMs: 0,
        heightOnly: false,
        firstMeasurement: true,
      }),
    ).toBe(0);
    expect(
      retargetDuration({
        animate: false,
        durationMs: 0,
        remainingMs: 220,
        heightOnly: false,
        firstMeasurement: true,
      }),
    ).toBe(0);
  });

  test("derives one morph duration from the motion profile for css and the native warp", () => {
    expect(morphDuration("fluid")).toBe(260);
    expect(morphDuration("gentle")).toBe(200);
    expect(morphDuration("reduced")).toBe(0);
    expect(morphMilliseconds("gentle")).toBe("200ms");
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
    const settings = updateMeasuredHeights(agent, "settings", 346);
    expect(settings.agent).toBe(170);
    expect(settings["settings"]).toBe(346);
    expect(updateMeasuredHeights(settings, "agent", 170.1)).toBe(settings);
  });
});
