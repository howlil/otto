import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsSurface } from "../../src/app/SettingsSurface";
import {
  defaults,
  type Preferences,
  type SettingsTab,
} from "../../src/features/shell/model/preferences";

afterEach(cleanup);

const agent = {
  readiness: {
    status: "ready",
    message: "",
    recovery: "",
    imageInput: false,
    imageTransport: false,
    model: null,
    models: [],
    thinkingEffort: null,
    thinkingEfforts: [],
  },
  provider: "codex",
  providers: [],
  setProvider: () => {},
  snapshot: { status: "idle", messages: [], threadId: null, model: null, usage: null },
  model: null,
  setModel: () => {},
  thinkingEffort: null,
  setThinkingEffort: () => {},
  refreshProvider: async () => {},
  locked: false,
  busy: false,
  captureBusy: false,
  error: null,
  capture: {
    source: "selectedText",
    selectSource: async () => {},
    targetTitle: null,
    targetWarning: null,
    targetPending: false,
    refreshTarget: async () => {},
    sourceReady: true,
    sourcePending: false,
    shortcut: "Ctrl+Shift+O",
    captureMessage: "",
    savingCapture: false,
    available: false,
    saveShortcut: async () => {},
  },
} as never;

function Harness({ initial = "assistant" as SettingsTab, onBack = () => {} }) {
  const [prefs, setPrefs] = useState<Preferences>({ ...defaults, hoverExpand: false });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initial);
  const shell = {
    prefs,
    change: (patch: Partial<Preferences>) => setPrefs((current) => ({ ...current, ...patch })),
    back: onBack,
    reducedMotion: true,
    settingsTab,
    setSettingsTab,
    settingsFocus: null,
    placement: {
      applied: prefs.placement,
      requested: prefs.placement,
      supported: true,
      ottoOs: false,
      error: null,
      attempt: 0,
      change: () => {},
      retry: () => {},
      resetPosition: () => {},
    },
    captureProtected: true,
    captureProtectionSupported: true,
    captureProtectionPending: false,
    captureProtectionError: null,
    setCaptureProtection: async () => {},
    quitSupported: true,
    quitOtto: async () => {},
  } as never;
  return (
    <SettingsSurface
      agent={agent}
      shell={shell}
      appUpdate={
        {
          state: { status: "current" },
          checkForUpdate: async () => {},
          installUpdate: async () => {},
        } as never
      }
      onMeasured={() => {}}
    />
  );
}

describe("one Settings surface", () => {
  test("merges agent and system settings into five reachable sections", () => {
    render(<Harness />);
    for (const name of ["Assistant", "Capture", "Behavior", "Position", "General"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    for (const gone of ["Interaction", "System", "Placement"]) {
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
    }
    expect(screen.getAllByRole("button", { name: "Back to Agent" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Assistant" })).toBeTruthy();
  });

  test("switching sections shows that section's controls and marks it current", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Behavior" }));
    expect(screen.getByRole("button", { name: "Behavior" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("checkbox", { name: "Expand on hover" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Keep expanded/ })).toBeTruthy();
    expect(document.getElementById("otto-shell-shortcut")).not.toBeNull();
    expect(screen.queryByText("Hover timing")).toBeNull();
    expect(screen.queryByText("Motion profile")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByText("Background")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Solid" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("slider", { name: /Opacity/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Hide from screen capture/ })).toBeTruthy();
    expect(screen.getByText("Updates")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quit" })).toBeTruthy();
    expect(screen.queryByText("Software update")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Transparent" }));
    const slider = screen.getByRole("slider", { name: /Opacity/ }) as HTMLInputElement;
    expect(slider.value).toBe("78");
    fireEvent.change(slider, { target: { value: "64" } });
    expect(slider.value).toBe("64");

    fireEvent.click(screen.getByRole("button", { name: "Solid" }));
    expect(screen.queryByRole("slider", { name: /Opacity/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transparent" }));
    expect((screen.getByRole("slider", { name: /Opacity/ }) as HTMLInputElement).value).toBe("64");
  });

  test("toggles apply immediately without a save button", () => {
    render(<Harness initial="behavior" />);
    const hover = screen.getByRole("checkbox", { name: "Expand on hover" }) as HTMLInputElement;
    expect(hover.checked).toBe(false);
    fireEvent.click(hover);
    expect(hover.checked).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  test("opens on the requested section and the arrow keys move between sections", () => {
    render(<Harness initial="capture" />);
    expect(screen.getByRole("button", { name: "Capture" }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Capture" }), { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Behavior" }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Behavior" }), { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: "Capture" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  test("back returns to the Agent", () => {
    let backs = 0;
    render(<Harness onBack={() => backs++} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to Agent" }));
    expect(backs).toBe(1);
  });
});
