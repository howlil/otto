import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GlobalSettings } from "../src/features/shell/GlobalSettings";
import { defaults, type Preferences } from "../src/features/shell/preferences";

afterEach(cleanup);

function Harness() {
  const [prefs, setPrefs] = useState<Preferences>({ ...defaults, hoverExpand: false });
  const placement = {
    applied: prefs.placement,
    requested: prefs.placement,
    supported: true,
    error: null,
    attempt: 0,
    change: () => {},
    retry: () => {},
  } as const;
  return (
    <GlobalSettings
      prefs={prefs}
      change={(patch) => setPrefs((current) => ({ ...current, ...patch }))}
      onBack={() => {}}
      onMeasured={() => {}}
      update={{
        state: { status: "current" },
        checkForUpdate: async () => {},
        installUpdate: async () => {},
      }}
      reducedMotion
      captureProtected={true}
      captureProtectionSupported
      captureProtectionPending={false}
      captureProtectionError={null}
      setCaptureProtection={async () => {}}
      taskbarReplacementSupported
      taskbarReplacementPending={false}
      taskbarReplacementError={null}
      setTaskbarReplacement={async () => {}}
      osEventsError={null}
      placement={placement}
    />
  );
}

describe("Global settings information architecture", () => {
  test("groups appearance, interaction, system, and placement into reachable sections", () => {
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Placement" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(screen.getByRole("heading", { name: "System" })).toBeTruthy();
    expect(screen.getByText("Software update")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Use Otto as taskbar/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Placement" }));
    expect(screen.getByRole("heading", { name: "Placement" })).toBeTruthy();
  });

  test("keeps interaction controls concise without motion or hover timing settings", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Interaction" }));
    expect(Boolean(screen.queryByText("Hover timing"))).toBe(false);
    expect(Boolean(screen.queryByText("Motion profile"))).toBe(false);
    expect(Boolean(screen.queryByText("Hide Otto"))).toBe(false);
    expect(screen.getByLabelText("Expand / compact shortcut")).toBeTruthy();
    const hover = screen.getByRole("checkbox", { name: "Expand on hover" }) as HTMLInputElement;
    expect(hover.checked).toBe(false);
    fireEvent.click(hover);
    expect(hover.checked).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Keep expanded" })).toBeTruthy();
  });
});
