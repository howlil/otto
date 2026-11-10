import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const ready = {
  revision: 1,
  phase: "focus",
  status: "ready",
  remainingSeconds: 1_500,
  durations: { focus: 25, short: 5, long: 15 },
  completedFocusSessions: 0,
};

let readSnapshot = ready;
let publish: ((snapshot: typeof ready) => void) | null = null;
let starts = 0;
let unsubscriptions = 0;

mock.module("../src/platform/tauri", () => ({
  nativeAvailable: true,
  getFocusTimerSnapshot: async () => readSnapshot,
  subscribeFocusTimer: async (onSnapshot: (snapshot: typeof ready) => void) => {
    publish = onSnapshot;
    return {
      channel: { onmessage: null },
      unsubscribe: async () => {
        unsubscriptions += 1;
      },
    };
  },
  startFocusTimer: async () => {
    starts += 1;
    return { ...ready, revision: 3, status: "running" };
  },
  pauseFocusTimer: async () => ready,
  resetFocusTimer: async () => ready,
  configureFocusTimer: async () => ready,
  selectFocusTimerPhase: async () => ready,
  startNextFocusTimer: async () => ready,
}));

const { useFocusTimer } = await import("../src/features/focus/useFocusTimer");

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  cleanup();
  readSnapshot = ready;
  publish = null;
  starts = 0;
  unsubscriptions = 0;
});

test("focus subscription keeps the newest timer snapshot and command result", async () => {
  const hook = renderHook(() => useFocusTimer());
  await waitFor(() => expect(hook.result.current.snapshot.revision).toBe(1));

  await act(async () => {
    publish?.({ ...ready, revision: 2, status: "running", remainingSeconds: 1_499 });
  });
  expect(hook.result.current.snapshot).toMatchObject({
    revision: 2,
    status: "running",
    remainingSeconds: 1_499,
  });

  await act(async () => {
    publish?.({ ...ready, revision: 1, status: "paused", remainingSeconds: 1_490 });
  });
  expect(hook.result.current.snapshot).toMatchObject({
    revision: 2,
    status: "running",
    remainingSeconds: 1_499,
  });

  await act(async () => {
    await hook.result.current.start();
  });
  expect(starts).toBe(1);
  expect(hook.result.current.snapshot).toMatchObject({ revision: 3, status: "running" });

  hook.unmount();
  await waitFor(() => expect(unsubscriptions).toBe(1));
});
