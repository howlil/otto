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
      ottoOsDetected: false,
      dockWithOttoOs: prefs.dockWithOttoOs,
      circleMode: prefs.compactStyle === "circle",
      error: null,
      attempt: 0,
      change: () => {},
      retry: () => {},
      resetPosition: () => {},
      setDockWithOttoOs: (dockWithOttoOs: boolean) =>
        setPrefs((current) => ({ ...current, dockWithOttoOs, position: null })),
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

function buttonNamed(name: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  return (
    buttons.find((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim() === name) ??
    null
  );
}

describe("one Settings surface", () => {
  test("merges agent and system settings into five reachable sections", () => {
    render(<Harness />);
    for (const name of ["Assistant", "Capture", "Behavior", "Position", "General"]) {
      expect(buttonNamed(name)).toBeTruthy();
    }
    for (const gone of ["Interaction", "System", "Placement", "Voice"]) {
      expect(buttonNamed(gone)).toBeNull();
    }
    expect(
      Array.from(document.querySelectorAll("button")).filter(
        (button) => (button.textContent ?? "").trim() === "Back to Agent",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Assistant" })).toBeTruthy();
  });

  test("switching sections shows that section's controls and marks it current", () => {
    render(<Harness />);
    const behavior = buttonNamed("Behavior")!;
    fireEvent.click(behavior);
    expect(behavior.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("checkbox", { name: /^Expand on hover/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Keep expanded/ })).toBeTruthy();
    expect(document.getElementById("otto-shell-shortcut")).not.toBeNull();
    expect(screen.queryByText("Hover timing")).toBeNull();
    expect(screen.queryByText("Motion profile")).toBeNull();

    fireEvent.click(buttonNamed("General")!);
    expect(screen.getByText("Background")).toBeTruthy();
    const solid = document.querySelector<HTMLButtonElement>('button[data-active-key="solid"]')!;
    const blur = document.querySelector<HTMLButtonElement>('button[data-active-key="blur"]')!;
    const liquidGlass = document.querySelector<HTMLButtonElement>(
      'button[data-active-key="liquid-glass"]',
    )!;
    expect(solid.getAttribute("aria-pressed")).toBe("true");
    expect(blur.getAttribute("aria-pressed")).toBe("false");
    expect(liquidGlass.getAttribute("aria-pressed")).toBe("false");
    expect(buttonNamed("Transparent")).toBeNull();
    expect(document.querySelector('[data-material-preview="solid"]')).not.toBeNull();
    expect(document.querySelector('[data-material-preview="blur"]')).not.toBeNull();
    expect(document.querySelector('[data-material-preview="liquid-glass"]')).not.toBeNull();
    expect(document.querySelector('input[type="range"][aria-label="Opacity"]')).toBeNull();
    expect(screen.getByText("Notch logo")).toBeTruthy();
    expect(buttonNamed("Extract SVG")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Hide from screen capture/ })).toBeTruthy();
    expect(screen.getByText("Updates")).toBeTruthy();
    expect(buttonNamed("Quit")).toBeTruthy();
    expect(screen.queryByText("Software update")).toBeNull();

    fireEvent.click(blur);
    const slider = screen.getByRole("slider", { name: /Opacity/ }) as HTMLInputElement;
    expect(slider.value).toBe("78");
    fireEvent.change(slider, { target: { value: "64" } });
    expect(slider.value).toBe("64");

    fireEvent.click(liquidGlass);
    expect(liquidGlass.getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("slider", { name: /Opacity/ }) as HTMLInputElement).value).toBe("64");

    fireEvent.click(solid);
    expect(screen.queryByRole("slider", { name: /Opacity/ })).toBeNull();

    fireEvent.click(buttonNamed("Diamond")!);
    const resetLogo = buttonNamed("Reset logo")!;
    expect(resetLogo).toBeTruthy();
    fireEvent.click(resetLogo);
    expect(buttonNamed("Reset logo")).toBeNull();
  });

  test("toggles apply immediately without a save button", () => {
    render(<Harness initial="behavior" />);
    const hover = screen.getByRole("checkbox", { name: /^Expand on hover/ }) as HTMLInputElement;
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
