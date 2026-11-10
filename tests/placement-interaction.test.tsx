import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

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

const { ShellFrame } = await import("../src/features/shell/ShellFrame");
const { PlacementSettings } = await import("../src/features/shell/PlacementSettings");
const { defaults } = await import("../src/features/shell/preferences");
const { useNotchShell } = await import("../src/features/shell/useNotchShell");

function save(preferences: Record<string, unknown> = {}) {
  localStorage.setItem(
    "otto.preferences.v1",
    JSON.stringify({ hoverExpand: false, motion: "reduced", ...preferences }),
  );
}

function persisted(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem("otto.preferences.v1") ?? "{}");
}

async function shellHook() {
  save();
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

    render(<PlacementSettings prefs={result.current.prefs} change={() => {}} placement={result.current.placement} />);

    expect(screen.getByText("Windows kept the previous notch placement.")).toBeTruthy();
    const floating = screen.getByRole("button", { name: "Floating" });
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
});
