import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, payload: unknown) => {
    if (command === "overlay_set_capture_protection") {
      return (payload as { enabled: boolean }).enabled;
    }
    if (command === "overlay_protection_status") return true;
    return null;
  },
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null;
  },
  Resource: class {
    rid: number;
    constructor(rid: number) {
      this.rid = rid;
    }
    async close() {}
  },
  transformCallback: (callback: unknown) => callback,
}));

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async () => () => {},
  }),
}));

const { ShellFrame } = await import("../../src/features/shell/ui/ShellFrame");
const { PositionSettings } = await import("../../src/features/shell/ui/settings/PositionSettings");
const { defaults } = await import("../../src/features/shell/model/preferences");
const { useNotchShell } = await import("../../src/features/shell/hooks/useNotchShell");

function save(preferences: Record<string, unknown> = {}) {
  localStorage.setItem(
    "otto.preferences.v1",
    JSON.stringify({ hoverExpand: false, motion: "reduced", ...preferences }),
  );
}

function persisted(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem("otto.preferences.v1") ?? "{}");
}

async function shellHook(preferences: Record<string, unknown> = {}) {
  save(preferences);
  const view = renderHook(() => useNotchShell());
  await act(async () => {});
  return view;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Notch placement recovery", () => {
  test("a placement Windows refuses keeps the observed one and reverts the preference", async () => {
    const { result } = await shellHook();
    expect(result.current.placement.applied).toBe("floating");

    act(() => result.current.placement.change("attached"));
    expect(result.current.placement.requested).toBe("attached");
    expect(result.current.placement.applied).toBe("floating");

    act(() => result.current.syncPlacement("floating"));

    expect(result.current.placement.applied).toBe("floating");
    expect(result.current.placement.requested).toBe("floating");
    expect(result.current.placement.error).toBe("Windows kept the previous notch placement.");
    expect(persisted().placement).toBe("floating");
  });

  test("a confirmed attached placement is adopted and persisted", async () => {
    const { result } = await shellHook();

    act(() => result.current.placement.change("attached"));
    act(() => result.current.syncPlacement("attached"));

    expect(result.current.placement.applied).toBe("attached");
    expect(result.current.placement.requested).toBe("attached");
    expect(result.current.placement.error).toBeNull();
    expect(persisted().placement).toBe("attached");
  });

  test("reset returns a saved custom position to the default host placement", async () => {
    const { result } = await shellHook({ position: { x: 144, y: 320 } });
    const resetCount = result.current.positionReset;

    expect(result.current.prefs.position).toEqual({ x: 144, y: 320 });
    act(() => result.current.placement.resetPosition());

    expect(result.current.prefs.position).toBeNull();
    expect(result.current.positionReset).toBe(resetCount + 1);
    expect(persisted().position).toBeNull();
  });

  test("placement settings expose the custom-position reset", async () => {
    const { result } = await shellHook({ position: { x: 144, y: 320 } });
    render(
      <PositionSettings
        prefs={result.current.prefs}
        change={() => {}}
        placement={result.current.placement}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(result.current.prefs.position).toBeNull();
  });

  test("placement settings offer no reset while Otto is at its default position", async () => {
    const { result } = await shellHook();
    render(
      <PositionSettings
        prefs={result.current.prefs}
        change={() => {}}
        placement={result.current.placement}
      />,
    );

    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.getByText("Drag Otto anywhere to move it.")).toBeTruthy();
  });

  test("a confirmed native placement change rearms hover after Escape dismissal", async () => {
    const { result } = await shellHook({ hoverExpand: true, hoverDelay: 0 });
    const surface = document.createElement("main");
    document.body.append(surface);
    const enter = {
      currentTarget: surface,
      pointerType: "mouse",
    } as Parameters<typeof result.current.handleEnter>[0];

    act(() => result.current.syncPlacement("attached"));
    act(() => result.current.handleEnter(enter));
    await waitFor(() => expect(result.current.expanded).toBe(true));

    act(() => result.current.dismiss());
    expect(result.current.expanded).toBe(false);

    act(() => result.current.syncPlacement("floating"));
    expect(result.current.placement.applied).toBe("floating");
    await act(async () => {});
    act(() => result.current.handleEnter(enter));

    await waitFor(() => expect(result.current.expanded).toBe(true));
    surface.remove();
  });

  test("retry clears the failure and requests the geometry again", async () => {
    const { result } = await shellHook();

    act(() => result.current.placement.change("attached"));
    act(() => result.current.syncPlacement("floating"));
    const attempts = result.current.placement.attempt;

    act(() => result.current.placement.retry());

    expect(result.current.placement.error).toBeNull();
    expect(result.current.placement.attempt).toBe(attempts + 1);
  });

  test("settings render the failure with a retry the user can press", async () => {
    const { result } = await shellHook();
    act(() => result.current.placement.change("attached"));
    act(() => result.current.syncPlacement("floating"));

    render(<PositionSettings prefs={result.current.prefs} change={() => {}} placement={result.current.placement} />);

    expect(screen.getByText("Windows kept the previous notch placement.")).toBeTruthy();
    const floating = screen.getByRole("button", { name: /^Floating/ });
    expect(floating.getAttribute("aria-pressed")).toBe("true");

    const attempts = result.current.placement.attempt;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(result.current.placement.attempt).toBe(attempts + 1);
    expect(result.current.placement.error).toBeNull();
  });

  test("attached reserves the shoulder gutter and floating does not", () => {
    const attached = render(
      <ShellFrame placement="attached" gutter={12}>
        <p>body</p>
      </ShellFrame>,
    );
    const frame = attached.container.querySelector("[data-placement='attached']") as HTMLElement;
    expect(frame.style.paddingLeft).toBe("");
    expect(frame.style.paddingRight).toBe("");
    expect(attached.container.querySelector(".otto-shoulder-l")?.closest("[data-surface-stage]")).toBeTruthy();
    expect(attached.container.querySelector(".otto-shoulder-r")?.closest("[data-surface-stage]")).toBeTruthy();
    expect(attached.container.querySelectorAll(".otto-shoulder-l, .otto-shoulder-r").length).toBe(2);
    attached.unmount();

    const floating = render(
      <ShellFrame placement="floating" gutter={0}>
        <p>body</p>
      </ShellFrame>,
    );
    const capsule = floating.container.querySelector("[data-placement='floating']") as HTMLElement;
    expect(capsule.style.paddingLeft).toBe("");
    expect(floating.container.querySelectorAll(".otto-shoulder-l, .otto-shoulder-r").length).toBe(0);
  });

  test("circle mode floats temporarily without overwriting a saved attached placement", async () => {
    const { result } = await shellHook({ placement: "attached" });
    act(() => result.current.syncPlacement("attached"));
    expect(result.current.placement.requested).toBe("attached");
    expect(result.current.compactCircle).toBe(false);

    act(() => result.current.toggleCompactStyle());
    expect(result.current.compactCircle).toBe(true);
    expect(result.current.prefs.compactStyle).toBe("circle");

    act(() => result.current.syncPlacement("floating"));
    expect(result.current.placement.error).toBeNull();
    expect(result.current.placement.requested).toBe("attached");
    expect(persisted().placement).toBe("attached");
    expect(persisted().compactStyle).toBe("circle");

    act(() => result.current.toggleCompactStyle());
    expect(result.current.compactCircle).toBe(false);
    expect(result.current.placement.requested).toBe("attached");
  });

  test("position settings switch compact style and explain automatic floating over attached", async () => {
    const { result } = await shellHook({ placement: "attached", compactStyle: "circle" });
    render(
      <PositionSettings
        prefs={result.current.prefs}
        change={result.current.change}
        placement={result.current.placement}
      />,
    );

    expect(screen.getByRole("button", { name: "Circle" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: /Attached/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      screen.getByText(
        "Circle mode floats automatically. Switch back to Capsule to restore Attached.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Capsule" }));
    expect(result.current.prefs.compactStyle).toBe("capsule");
  });
});
