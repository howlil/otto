import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { FocusCapsule, FocusPanel } from "../src/features/focus";
import { HomeSurface } from "../src/features/home";
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

function focusModel(
  snapshot: TimerSnapshot,
  calls: {
    start: number;
    pause: number;
    startNext: number;
    select: Array<[string, boolean]>;
    configure: Array<{ focus: number; short: number; long: number }>;
  },
): FocusTimerModel {
  return {
    snapshot,
    pending: false,
    error: null,
    errorKind: null,
    clearError: () => {},
    retryConnection: async () => {},
    start: async () => {
      calls.start += 1;
      return true;
    },
    pause: async () => {
      calls.pause += 1;
      return true;
    },
    reset: async () => true,
    configure: async (durations) => {
      calls.configure.push(durations);
      return true;
    },
    selectPhase: async (phase, discardActive) => {
      calls.select.push([phase, discardActive]);
      return true;
    },
    startNext: async () => {
      calls.startNext += 1;
      return true;
    },
  };
}

function calls() {
  return { start: 0, pause: 0, startNext: 0, select: [], configure: [] };
}

afterEach(cleanup);

test("Home exposes Focus as a Pomodoro destination", () => {
  let opened = 0;
  render(
    <HomeSurface
      homeGear={createRef()}
      agentSubtitle="Ask your CLI"
      artProps={{ tilt: 43, gradient: 80 }}
      onOpenSettings={() => {}}
      onOpenAgent={() => {}}
      onOpenFocus={() => {
        opened += 1;
      }}
    />,
  );

  const focus = screen.getByRole("button", { name: /Focus Pomodoro/ });
  expect(focus.hasAttribute("disabled")).toBe(false);
  fireEvent.click(focus);
  expect(opened).toBe(1);
});
test("compact Focus resumes its existing session without opening the panel", () => {
  const recorded = calls();
  render(
    <FocusCapsule
      snapshot={timerSnapshot({ status: "paused", remainingSeconds: 1_490 })}
      pending={false}
      buttonRef={createRef()}
      onOpen={() => {}}
      onStart={() => {
        recorded.start += 1;
      }}
      onPause={() => {
        recorded.pause += 1;
      }}
      onStartNext={() => {
        recorded.startNext += 1;
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Resume timer" }));

  expect(recorded.start).toBe(1);
  expect(recorded.pause).toBe(0);
  expect(recorded.startNext).toBe(0);
});
test("active Focus phase change requires an explicit discard confirmation", async () => {
  const recorded = calls();
  render(
    <FocusPanel
      focus={focusModel(timerSnapshot({ status: "running", remainingSeconds: 1_490 }), recorded)}
      settings={false}
      onSettings={() => {}}
      onSettingsBack={() => {}}
      onHome={() => {}}
    />,
  );

  const shortPhase = screen.getByRole("button", { name: "Short" });
  fireEvent.click(shortPhase);

  const dialog = screen.getByRole("dialog");
  expect(recorded.select).toEqual([]);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep timer" })), {
    timeout: 500,
  });

  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(shortPhase), { timeout: 500 });
  expect(recorded.select).toEqual([]);

  fireEvent.click(shortPhase);
  fireEvent.click(screen.getByRole("button", { name: "Switch phase" }));

  await waitFor(() => expect(recorded.select).toEqual([["short", true]]));
});

test("Focus Home control renders Otto eyes and preserves the active session", () => {
  const recorded = calls();
  let homeVisits = 0;
  render(
    <FocusPanel
      focus={focusModel(timerSnapshot({ status: "running", remainingSeconds: 1_490 }), recorded)}
      settings={false}
      onSettings={() => {}}
      onSettingsBack={() => {}}
      onHome={() => { homeVisits += 1; }}
    />,
  );

  const home = screen.getByRole("button", { name: "Back to Home" });
  expect(home.querySelector('[data-expression="calm"]')).not.toBeNull();
  fireEvent.click(home);
  expect(homeVisits).toBe(1);
  expect(screen.getByText("24:50")).toBeTruthy();
  expect(recorded.pause).toBe(0);
});

test("phase confirmation contains keyboard navigation and Escape keeps the timer", async () => {
  const recorded = calls();
  render(
    <FocusPanel
      focus={focusModel(timerSnapshot({ status: "paused" }), recorded)}
      settings={false}
      onSettings={() => {}}
      onSettingsBack={() => {}}
      onHome={() => {}}
    />,
  );
  const phase = screen.getByRole("button", { name: "Long" });
  fireEvent.click(phase);
  const keep = screen.getByRole("button", { name: "Keep timer" });
  const change = screen.getByRole("button", { name: "Switch phase" });
  await waitFor(() => expect(document.activeElement === keep).toBe(true));
  fireEvent.keyDown(keep, { key: "Tab", shiftKey: true });
  expect(document.activeElement === change).toBe(true);
  fireEvent.keyDown(change, { key: "Tab" });
  expect(document.activeElement === keep).toBe(true);
  fireEvent.keyDown(keep, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(recorded.select).toEqual([]);
  expect(document.activeElement).toBe(phase);
});

test("a pending or rejected phase switch keeps the dialog recoverable", async () => {
  const recorded = calls();
  const model = focusModel(timerSnapshot({ status: "paused" }), recorded);
  model.selectPhase = async () => false;
  const panel = (pending: boolean) => (
    <FocusPanel
      focus={{ ...model, pending }}
      settings={false}
      onSettings={() => {}}
      onSettingsBack={() => {}}
      onHome={() => {}}
    />
  );
  const view = render(panel(false));
  fireEvent.click(screen.getByRole("button", { name: "Short" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch phase" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  view.rerender(panel(true));
  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(document.activeElement === dialog).toBe(true));
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement === dialog).toBe(true);
  expect((screen.getByRole("button", { name: "Switch phase" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(panel(false));
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement === screen.getByRole("button", { name: "Keep timer" })).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Keep timer" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "Resume timer" })).toBeTruthy();
});

test("compact completion starts the next phase only through its primary action", () => {
  let starts = 0;
  render(
    <FocusCapsule
      snapshot={timerSnapshot({ status: "completed", remainingSeconds: 0, completedFocusSessions: 4 })}
      pending={false}
      buttonRef={createRef()}
      onOpen={() => {}}
      onStart={() => { throw new Error("Completed sessions cannot resume"); }}
      onPause={() => {}}
      onStartNext={() => { starts += 1; }}
    />,
  );
  expect(screen.getByText("Complete")).toBeTruthy();
  expect(starts).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Start long break" }));
  expect(starts).toBe(1);
});

test("short breaks render the canonical padded countdown", () => {
  const recorded = calls();
  render(
    <FocusPanel
      focus={focusModel(timerSnapshot({ phase: "short", remainingSeconds: 300 }), recorded)}
      settings={false}
      onSettings={() => {}}
      onSettingsBack={() => {}}
      onHome={() => {}}
    />,
  );
  expect(screen.getByText("05:00")).toBeTruthy();
});

test("cycle dots restart after four sessions but retain the completed long-break cycle", () => {
  const recorded = calls();
  const panel = (snapshot: TimerSnapshot) => (
    <FocusPanel
      focus={focusModel(snapshot, recorded)}
      settings={false}
      onSettings={() => {}}
      onSettingsBack={() => {}}
      onHome={() => {}}
    />
  );
  const view = render(panel(timerSnapshot({ completedFocusSessions: 4 })));
  expect(screen.queryByText("0/4") !== null).toBe(true);
  view.rerender(panel(timerSnapshot({ phase: "long", completedFocusSessions: 4 })));
  expect(screen.queryByText("4/4") !== null).toBe(true);
});

test("duration settings send the complete adjusted duration contract", async () => {
  const recorded = calls();
  render(
    <FocusPanel
      focus={focusModel(timerSnapshot(), recorded)}
      settings
      onSettings={() => {}}
      onSettingsBack={() => {}}
      onHome={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "50m" }));

  await waitFor(() =>
    expect(recorded.configure).toEqual([{ focus: 50, short: 5, long: 15 }]),
  );
});
