import { useCallback, useRef, useState } from "react";
import {
  configureFocusTimer,
  nativeAvailable,
  pauseFocusTimer,
  resetFocusTimer,
  selectFocusTimerPhase,
  startFocusTimer,
  startNextFocusTimer,
  type TimerDurations,
  type TimerPhase,
  type TimerSnapshot,
} from "../../platform/tauri/focus";

type Action = () => Promise<TimerSnapshot>;

export function useFocusTimerActions({
  receive,
  clearError,
  reportConnectionError,
  reportRequestError,
  isMounted,
}: {
  receive: (snapshot: TimerSnapshot) => void;
  clearError: () => void;
  reportConnectionError: (message: string) => void;
  reportRequestError: (reason: unknown) => void;
  isMounted: () => boolean;
}) {
  const [pending, setPending] = useState(false);
  const actionInFlight = useRef(false);
  const runAction = useCallback(
    async (action: Action) => {
      if (actionInFlight.current) return false;
      if (!nativeAvailable) {
        reportConnectionError("Focus timer is available in the Otto desktop app.");
        return false;
      }
      actionInFlight.current = true;
      setPending(true);
      clearError();
      try {
        const snapshot = await action();
        if (isMounted()) receive(snapshot);
        return true;
      } catch (reason) {
        if (isMounted()) reportRequestError(reason);
        return false;
      } finally {
        actionInFlight.current = false;
        if (isMounted()) setPending(false);
      }
    },
    [clearError, isMounted, receive, reportConnectionError, reportRequestError],
  );

  const start = useCallback(() => runAction(startFocusTimer), [runAction]);
  const pause = useCallback(() => runAction(pauseFocusTimer), [runAction]);
  const reset = useCallback(() => runAction(resetFocusTimer), [runAction]);
  const configure = useCallback(
    (durations: TimerDurations) => runAction(() => configureFocusTimer(durations)),
    [runAction],
  );
  const selectPhase = useCallback(
    (phase: TimerPhase, discardActive: boolean) =>
      runAction(() => selectFocusTimerPhase(phase, discardActive)),
    [runAction],
  );
  const startNext = useCallback(() => runAction(startNextFocusTimer), [runAction]);

  return { pending, start, pause, reset, configure, selectPhase, startNext };
}
