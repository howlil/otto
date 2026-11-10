import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import type { FocusTimerModel } from "../src/features/focus";
import type { TimerSnapshot } from "../src/platform/tauri";

function timerSnapshot(overrides: Partial<TimerSnapshot> = {}): TimerSnapshot {
  return {
    revision: 1,
    phase: "focus",
    status: "ready",
    remainingSeconds: 25 * 60,
    durations: { focus: 25, short: 5, long: 15 },
    completedFocusSessions: 0,
    ...overrides,
  };
}

function focusModel(snapshot: TimerSnapshot): FocusTimerModel {
  return {
    snapshot,
    pending: false,
    error: null,
    errorKind: null,
    clearError: () => {},
    retryConnection: async () => {},
    start: async () => true,
    pause: async () => true,
    reset: async () => true,
    configure: async () => true,
    selectPhase: async () => true,
    startNext: async () => true,
  };
}

let observed = timerSnapshot();
let publish: ((snapshot: TimerSnapshot) => void) | null = null;

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, payload: { onEvent?: { onmessage: typeof publish }; enabled?: boolean }) => {
    if (command === "focus_timer_subscribe") {
      publish = (next) => payload.onEvent?.onmessage?.(next);
      return 1;
    }
    if (command === "focus_timer_snapshot") return observed;
    if (command === "focus_timer_start") {
      observed = { ...observed, revision: observed.revision + 1, status: "running" };
      return observed;
    }
    if (command === "overlay_set_capture_protection") return payload.enabled;
    if (command === "overlay_protection_status") return true;
    return null;
  },
  Channel: class { onmessage: typeof publish = null; },
  Resource: class {
    rid: number;
    constructor(rid: number) { this.rid = rid; }
    async close() {}
  },
  transformCallback: (callback: unknown) => callback,
}));
mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));

const { ShellContent } = await import("../src/ShellContent");
const { useFocusTimer } = await import("../src/features/focus");
const { useNotchShell } = await import("../src/features/shell");

afterEach(() => {
  cleanup();
  localStorage.clear();
  observed = timerSnapshot();
  publish = null;
});

function NavigationHarness() {
  const shell = useNotchShell();
  const focus = useFocusTimer();
  return (
    <ShellContent
      agent={{} as Parameters<typeof ShellContent>[0]["agent"]}
      music={{} as Parameters<typeof ShellContent>[0]["music"]}
      focus={focus}
      shell={shell}
      agentHomeCopy="Ask your CLI"
      musicHomeCopy="No media session"
      artProps={{ tilt: 43, gradient: 80 }}
      onContentMeasured={() => {}}
      appUpdate={{ state: { status: "idle" }, checkForUpdate: async () => {}, installUpdate: async () => {} }}
      osEvent={null}
    />
  );
}

test("Home navigation preserves the running timer and receives updates while Focus is closed", async () => {
  localStorage.setItem("otto.preferences.v1", JSON.stringify({ hoverExpand: false, motion: "reduced" }));
  render(<NavigationHarness />);
  fireEvent.click(screen.getByRole("button", { name: "Open Otto" }));
  fireEvent.click(await screen.findByRole("button", { name: /Focus Pomodoro/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));
  await screen.findByRole("button", { name: "Pause timer" });
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  const settings = await screen.findByRole("button", { name: "Open Otto settings" });
  settings.focus();

  await act(async () => {
    publish?.({ ...observed, revision: observed.revision + 1, remainingSeconds: 1_499 });
  });
  expect(document.activeElement === settings).toBe(true);
  expect(screen.queryByText("Focus timer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Focus Pomodoro/ }));
  await waitFor(() => expect(screen.getByText("24:59")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Pause timer" })).toBeTruthy();
});

test("leaving duration settings restores focus to its trigger, including Escape", async () => {
  localStorage.setItem("otto.preferences.v1", JSON.stringify({ hoverExpand: false, motion: "reduced" }));
  render(<NavigationHarness />);
  fireEvent.click(screen.getByRole("button", { name: "Open Otto" }));
  fireEvent.click(await screen.findByRole("button", { name: /Focus Pomodoro/ }));
  const edit = await screen.findByRole("button", { name: "Edit durations" });
  edit.focus();
  fireEvent.click(edit);
  const done = await screen.findByRole("button", { name: "Done" });
  done.focus();
  fireEvent.click(done);
  await waitFor(() => expect(document.activeElement === screen.getByRole("button", { name: "Edit durations" })).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Edit durations" }));
  const close = await screen.findByRole("button", { name: "Close duration settings" });
  close.focus();
  fireEvent.keyDown(close, { key: "Escape" });
  await waitFor(() => expect(document.activeElement === screen.getByRole("button", { name: "Edit durations" })).toBe(true));
  expect(screen.queryByRole("heading", { name: "Focus presets" })).toBeNull();
});

test("a background Focus snapshot preserves the active surface and keyboard focus", () => {
  const music = {} as Parameters<typeof ShellContent>[0]["music"];
  let navigationAttempts = 0;
  const shell = {
    expanded: true,
    isAgent: false,
    page: "focus",
    reducedMotion: true,
    eventMotion: "",
    compactButton: createRef<HTMLButtonElement>(),
    open: () => {
      navigationAttempts += 1;
    },
    setPage: () => {
      navigationAttempts += 1;
    },
  } as unknown as Parameters<typeof ShellContent>[0]["shell"];
  const appUpdate = {
    state: { status: "idle" as const },
    checkForUpdate: async () => {},
    installUpdate: async () => {},
  };
  const view = render(
    <ShellContent
      agent={{} as Parameters<typeof ShellContent>[0]["agent"]}
      music={music}
      focus={focusModel(timerSnapshot())}
      shell={shell}
      agentHomeCopy="Ask your CLI"
      musicHomeCopy="No media session"
      artProps={{ tilt: 43, gradient: 80 }}
      onContentMeasured={() => {}}
      appUpdate={appUpdate}
      osEvent={null}
    />,
  );
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();

  view.rerender(
    <ShellContent
      agent={{} as Parameters<typeof ShellContent>[0]["agent"]}
      music={music}
      focus={focusModel(timerSnapshot({ revision: 2, status: "running", remainingSeconds: 1_499 }))}
      shell={shell}
      agentHomeCopy="Ask your CLI"
      musicHomeCopy="No media session"
      artProps={{ tilt: 43, gradient: 80 }}
      onContentMeasured={() => {}}
      appUpdate={appUpdate}
      osEvent={null}
    />,
  );

  expect(screen.getByText("Focus timer")).toBeTruthy();
  expect(screen.getByText("24:59")).toBeTruthy();
  expect(document.activeElement).toBe(outside);
  expect(navigationAttempts).toBe(0);
  outside.remove();
});
