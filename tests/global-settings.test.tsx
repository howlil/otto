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

    fireEvent.click(screen.getByRole("button", { name: "Placement" }));
    expect(screen.getByRole("heading", { name: "Placement" })).toBeTruthy();
  });

  test("disables hover timing while hover expansion is off and restores it when enabled", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Interaction" }));

    const hoverIntent = screen.getByText("Hover intent").closest("label")?.querySelector("input");
    if (!(hoverIntent instanceof HTMLInputElement)) throw new Error("Hover intent range missing");
    expect(hoverIntent.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Expand on hover" }));
    expect(hoverIntent.disabled).toBe(false);
  });
});
