import { afterEach, expect, test } from "bun:test";
import { cleanup, render, renderHook } from "@testing-library/react";
import { readPreferences } from "../../src/features/shell/model/preferences";
import { useNotchShell } from "../../src/features/shell/hooks/useNotchShell";
import { surfaceLayout } from "../../src/features/shell/surface-sync/layout";
import { ShellFrame } from "../../src/features/shell/ui/ShellFrame";
import type { NotchHost, NotchLayouts } from "../../src/platform/tauri";

const host: NotchHost = {
  revision: 1, placement: "attached", width: 550, height: 610, scale: 2, contentTop: 32,
  layouts: {
    agentCompact: [228, 72],
    settings: [526, 452],
    agentReady: [526, 202],
  } as NotchLayouts,
};
afterEach(() => { cleanup(); localStorage.clear(); });

test("old sizing preferences are retired without losing other saved preferences", () => {
  for (const sizingPreset of ["default", "mac-native", undefined, "unknown", null, 1]) {
    localStorage.setItem("otto.preferences.v1", JSON.stringify({ sizingPreset, placement: "attached" }));
    const preferences = readPreferences();
    expect(preferences).not.toHaveProperty("sizingPreset");
    expect(preferences.placement).toBe("attached");
  }
  const reopened = renderHook(() => useNotchShell());
  expect(reopened.result.current.prefs).not.toHaveProperty("sizingPreset");
  expect(JSON.parse(localStorage.getItem("otto.preferences.v1") ?? "{}")).not.toHaveProperty("sizingPreset");
});

test("saved panel coordinates survive preference parsing while malformed coordinates are ignored", () => {
  localStorage.setItem(
    "otto.preferences.v1",
    JSON.stringify({ position: { x: -1440, y: 320 } }),
  );
  expect(readPreferences().position).toEqual({ x: -1440, y: 320 });

  localStorage.setItem("otto.preferences.v1", JSON.stringify({ position: { x: 1.5, y: 320 } }));
  expect(readPreferences().position).toBeNull();
});

test("content sizing reserves camera space, clamps display capacity and rounds to the current DPI", () => {
  expect(surfaceLayout("agentReady", "attached", 240, host)).toEqual({ width: 526, height: 272 });
  expect(surfaceLayout("agentCompact", "attached", undefined, host)).toEqual({ width: 228, height: 72 });
  expect(surfaceLayout("agentCompact", "capsule", undefined, null)).toEqual({ width: 228, height: 40 });
  for (const scale of [1, 1.5, 2]) {
    const size = surfaceLayout("agentReady", "attached", 900, { ...host, width: 400, height: 300, scale });
    expect(size.height).toBe(300);
    expect(size.width).toBe(376);
  }
  expect(surfaceLayout("agentReady", "card", 240, { ...host, contentTop: 0 })).toEqual({ width: 526, height: 240 });
});

test("Agent compact uses its native bounds and reduced motion stays immediate", () => {
  const view = render(<ShellFrame placement="attached" gutter={12} size={{ width: 228, height: 72 }}
    nativeSize={host} morphMs={0} stageRef={{ current: null }}>
    <div data-surface="agentCompact" />
  </ShellFrame>);
  const frame = view.container.querySelector<HTMLElement>("[data-sizing]");
  expect(frame?.dataset.sizing).toBe("mac-native");
  expect(frame?.style.getPropertyValue("--otto-morph-duration")).toBe("0ms");
  expect(view.container.querySelector('[data-surface="agentCompact"]')).not.toBeNull();
});
