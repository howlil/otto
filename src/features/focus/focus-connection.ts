import { useCallback, useEffect, useRef, useState } from "react";
import {
  getFocusTimerSnapshot,
  nativeAvailable,
  subscribeFocusTimer,
  type FocusTimerSubscription,
  type TimerSnapshot,
} from "../../platform/tauri/focus";

export type FocusTimerErrorKind = "connection" | "request" | null;

type SubscriptionResult = {
  subscription: FocusTimerSubscription | null;
  error: string | null;
};

function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return fallback;
}

async function subscribeToFocusTimer(
  isCurrent: () => boolean,
  receive: (snapshot: TimerSnapshot) => void,
): Promise<SubscriptionResult> {
  try {
    const subscription = await subscribeFocusTimer((snapshot) => {
      if (isCurrent()) receive(snapshot);
    });
    return { subscription, error: null };
  } catch (reason) {
    return {
      subscription: null,
      error: errorMessage(reason, "Cannot listen to focus timer updates."),
    };
  }
}

async function readFocusTimer(): Promise<{ snapshot: TimerSnapshot | null; error: string | null }> {
  try {
    return { snapshot: await getFocusTimerSnapshot(), error: null };
  } catch (reason) {
    return {
      snapshot: null,
      error: errorMessage(reason, "Cannot connect to the Otto desktop process."),
    };
  }
}

export function useFocusConnection(receive: (snapshot: TimerSnapshot) => void) {
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<FocusTimerErrorKind>(null);
  const mounted = useRef(false);
  const subscription = useRef<FocusTimerSubscription | null>(null);
  const connectionAttempt = useRef(0);
  const clearError = useCallback(() => {
    setError(null);
    setErrorKind(null);
  }, []);
  const reportConnectionError = useCallback((message: string) => {
    setError(message);
    setErrorKind("connection");
  }, []);
  const reportRequestError = useCallback((reason: unknown) => {
    setError(errorMessage(reason, "Focus timer action failed."));
    setErrorKind("request");
  }, []);
  const connect = useCallback(async () => {
    const attempt = ++connectionAttempt.current;
    const isCurrent = () => mounted.current && attempt === connectionAttempt.current;
    clearError();
    const previous = subscription.current;
    subscription.current = null;
    await previous?.unsubscribe().catch(() => undefined);
    if (!isCurrent()) return;

    const eventResult = await subscribeToFocusTimer(isCurrent, receive);
    if (!isCurrent()) {
      await eventResult.subscription?.unsubscribe().catch(() => undefined);
      return;
    }
    if (eventResult.error) reportConnectionError(eventResult.error);
    else subscription.current = eventResult.subscription;

    const snapshotResult = await readFocusTimer();
    if (!isCurrent()) return;
    if (snapshotResult.error) reportConnectionError(snapshotResult.error);
    else if (snapshotResult.snapshot) receive(snapshotResult.snapshot);
  }, [clearError, receive, reportConnectionError]);

  useEffect(() => {
    mounted.current = true;
    if (!nativeAvailable) {
      reportConnectionError("Focus timer is available in the Otto desktop app.");
      return () => {
        mounted.current = false;
      };
    }
    void connect();
    return () => {
      mounted.current = false;
      connectionAttempt.current += 1;
      const activeSubscription = subscription.current;
      subscription.current = null;
      void activeSubscription?.unsubscribe().catch(() => undefined);
    };
  }, [connect, reportConnectionError]);

  const retryConnection = useCallback(async () => {
    if (nativeAvailable) await connect();
  }, [connect]);

  return {
    error,
    errorKind,
    clearError,
    retryConnection,
    reportConnectionError,
    reportRequestError,
    isMounted: () => mounted.current,
  };
}
