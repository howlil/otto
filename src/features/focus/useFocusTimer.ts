import { useCallback, useState } from "react";
import type { TimerDurations, TimerPhase, TimerSnapshot } from "../../platform/tauri/focus";
import { useFocusTimerActions } from "./focus-actions";
import { useFocusConnection, type FocusTimerErrorKind } from "./focus-connection";

export type { FocusTimerErrorKind } from "./focus-connection";

export type FocusTimerModel = {
  snapshot: TimerSnapshot;
  pending: boolean;
  error: string | null;
  errorKind: FocusTimerErrorKind;
  clearError: () => void;
  retryConnection: () => Promise<void>;
  start: () => Promise<boolean>;
  pause: () => Promise<boolean>;
  reset: () => Promise<boolean>;
  configure: (durations: TimerDurations) => Promise<boolean>;
  selectPhase: (phase: TimerPhase, discardActive: boolean) => Promise<boolean>;
  startNext: () => Promise<boolean>;
};

const initialSnapshot: TimerSnapshot = {
  revision: 0,
  phase: "focus",
  status: "ready",
  remainingSeconds: 25 * 60,
  durations: { focus: 25, short: 5, long: 15 },
  completedFocusSessions: 0,
};

export function useFocusTimer(): FocusTimerModel {
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(initialSnapshot);
  const receive = useCallback((next: TimerSnapshot) => {
    setSnapshot((previous) => (next.revision >= previous.revision ? next : previous));
  }, []);
  const connection = useFocusConnection(receive);
  const actions = useFocusTimerActions({ receive, ...connection });

  return {
    snapshot,
    ...connection,
    ...actions,
  };
}
