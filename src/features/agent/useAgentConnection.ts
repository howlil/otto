import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAgentSnapshot,
  nativeAvailable,
  subscribeAgent,
  type AgentSnapshot,
  type AgentSubscription,
} from "../../platform/tauri/agent";

export type AgentErrorKind = "connection" | "request" | null;
type AgentChannel = AgentSubscription;

async function subscribeToAgentEvents(
  isCurrent: () => boolean,
  receive: (next: AgentSnapshot) => void,
): Promise<{ subscription: AgentChannel | null; error: string | null }> {
  try {
    const channel = await subscribeAgent((next) => {
      if (isCurrent()) receive(next);
    });
    return { subscription: channel, error: null };
  } catch {
    return { subscription: null, error: "Cannot listen to agent events." };
  }
}

async function readAgentSnapshot(): Promise<{
  value: AgentSnapshot | null;
  error: string | null;
}> {
  try {
    return { value: await getAgentSnapshot(), error: null };
  } catch {
    return { value: null, error: "Cannot connect to the Otto desktop process." };
  }
}

export function useAgentConnection(
  receive: (next: AgentSnapshot) => void,
  acceptSnapshot: (next: AgentSnapshot) => void,
) {
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<AgentErrorKind>(null);
  const subscription = useRef<AgentChannel | null>(null);
  const connectionAttempt = useRef(0);
  const mounted = useRef(false);

  const clearError = useCallback(() => {
    setError(null);
    setErrorKind(null);
  }, []);
  const setRequestError = useCallback((reason: unknown) => {
    setError(String(reason));
    setErrorKind("request");
  }, []);
  const connect = useCallback(async () => {
    const attempt = ++connectionAttempt.current;
    clearError();
    const isCurrent = () => mounted.current && attempt === connectionAttempt.current;
    const previous = subscription.current;
    subscription.current = null;
    if (previous) await previous.unsubscribe().catch(() => undefined);
    if (!isCurrent()) return;

    const result = await subscribeToAgentEvents(isCurrent, receive);
    if (!isCurrent()) {
      await result.subscription?.unsubscribe().catch(() => undefined);
      return;
    }
    if (result.error) {
      setError(result.error);
      setErrorKind("connection");
    } else {
      subscription.current = result.subscription;
    }

    const snapshotResult = await readAgentSnapshot();
    if (!isCurrent()) return;
    if (snapshotResult.error) {
      setError(snapshotResult.error);
      setErrorKind("connection");
    } else if (snapshotResult.value) {
      acceptSnapshot(snapshotResult.value);
    }
  }, [acceptSnapshot, clearError, receive]);

  useEffect(() => {
    if (!nativeAvailable) return;
    mounted.current = true;
    void connect();
    return () => {
      mounted.current = false;
      connectionAttempt.current += 1;
      const activeSubscription = subscription.current;
      subscription.current = null;
      void activeSubscription?.unsubscribe().catch(() => undefined);
    };
  }, [connect]);

  const retryConnection = useCallback(async () => {
    if (nativeAvailable) await connect();
  }, [connect]);

  return { error, errorKind, retryConnection, clearError, setRequestError };
}
