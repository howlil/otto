import { afterEach, expect, test } from "bun:test";
import { cleanup, render, renderHook } from "@testing-library/react";
import { GeneralSettings } from "../src/features/shell/GeneralSettings";
import { defaults, readPreferences } from "../src/features/shell/preferences";
import { useNotchShell } from "../src/features/shell/useNotchShell";
import { surfaceLayout } from "../src/features/shell/surface-sync/layout";
import { ShellFrame } from "../src/features/shell/ShellFrame";
import { CompactEyesButton } from "../src/ShellSurfaces";
import type { NotchHost, NotchLayouts } from "../src/platform/tauri";

const host: NotchHost = {
  revision: 1, placement: "attached", width: 550, height: 610, scale: 2, contentTop: 32,
  layouts: { idle: [185, 56], agentReady: [526, 202], musicCompact: [264, 76] } as NotchLayouts,
};
afterEach(() => { cleanup(); localStorage.clear(); });

test("old sizing preferences are retired without losing other saved preferences", () => {
  for (const sizingPreset of ["default", "mac-native", undefined, "unknown", null, 1]) {
    localStorage.setItem("otto.preferences.v1", JSON.stringify({ sizingPreset, expression: "happy", placement: "attached" }));
    const preferences = readPreferences();
    expect(preferences).not.toHaveProperty("sizingPreset");
    expect(preferences.expression).toBe("happy");
    expect(preferences.placement).toBe("attached");
  }
  const reopened = renderHook(() => useNotchShell());
  expect(reopened.result.current.prefs).not.toHaveProperty("sizingPreset");
  expect(JSON.parse(localStorage.getItem("otto.preferences.v1") ?? "{}")).not.toHaveProperty("sizingPreset");
});

test("Appearance no longer exposes a sizing selector", () => {
  const view = render(<GeneralSettings prefs={defaults} change={() => {}} onRestoreDefaults={() => {}} captureProtectionPending={false} />);
  expect(view.queryByText("Sizing")).toBeNull();
  expect(view.queryByText("Otto Default")).toBeNull();
  expect(view.getByText("Expression")).toBeTruthy();
});

test("content sizing reserves camera space, clamps display capacity and rounds to the current DPI", () => {
  expect(surfaceLayout("agentReady", "attached", 240, host)).toEqual({ width: 526, height: 272 });
  expect(surfaceLayout("idle", "attached", undefined, host)).toEqual({ width: 185, height: 56 });
  expect(surfaceLayout("idle", "capsule", undefined, null)).toEqual({ width: 185, height: 32 });
  for (const scale of [1, 1.5, 2]) {
    const size = surfaceLayout("agentReady", "attached", 900, { ...host, width: 400, height: 300, scale });
    expect(size.height).toBe(300);
    expect(size.width).toBe(376);
  }
  expect(surfaceLayout("agentReady", "card", 240, { ...host, contentTop: 0 })).toEqual({ width: 526, height: 240 });
});

test("native idle keeps undistorted eyes in its drawable row and reduced motion stays immediate", () => {
  const view = render(<ShellFrame placement="attached" gutter={12} size={{ width: 185, height: 56 }}
    nativeSize={host} morphMs={0} stageRef={{ current: null }} sizingHost={host}>
    <CompactEyesButton expanded={false} prefs={defaults} buttonRef={{ current: null }} reducedMotion onToggle={() => {}} />
  </ShellFrame>);
  const frame = view.container.querySelector<HTMLElement>("[data-sizing]");
  expect(frame?.dataset.sizing).toBe("mac-native");
  expect(frame?.style.getPropertyValue("--otto-idle-height")).toBe("24px");
  expect(frame?.style.getPropertyValue("--otto-idle-width")).toBe("185px");
  expect(frame?.style.getPropertyValue("--otto-morph-duration")).toBe("0ms");
  expect(view.getByRole("button").className).not.toContain("transition-");
});
