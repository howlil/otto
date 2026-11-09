import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ShellContent } from "../src/ShellContent";
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

afterEach(cleanup);

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
