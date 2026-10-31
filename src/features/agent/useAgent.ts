import { useCallback, useEffect, useRef, useState } from "react";
import {
  askCodex,
  getCodexReadiness,
  configureCaptureShortcut,
  nativeAvailable,
  decideAgentApproval,
  getAgentSnapshot,
  nativeAvailable,
  newAgentSession,
  stopCodex,
  subscribeAgent,
  type AgentMode,
  type AgentSnapshot,
  type AgentSubscription,
  type ProviderReadiness,
} from "../../platform/tauri";

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
    return { subscription: null, error: "Cannot listen to Codex events." };
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

const initial: AgentSnapshot = {
  runId: 0,
  seq: 0,
  status: "idle",
  mode: "quickAsk",
  cwd: "",
  threadId: null,
  messages: [],
  error: null,
};

const checking: ProviderReadiness = {
  status: "checking",
  message: "Checking Codex…",
  recovery: "",
  imageInput: false,
};

function useProviderReadiness(cwd: string) {
  const [readiness, setReadiness] = useState<ProviderReadiness>(checking);
  const projectRef = useRef("");
  const probeRef = useRef(0);

  const refreshProvider = useCallback(async () => {
    const probe = ++probeRef.current;
    setReadiness(checking);
    if (!nativeAvailable) {
      setReadiness({
        status: "unavailable",
        message: "Codex readiness requires the Otto desktop app.",
        recovery: "Open Otto on Windows.",
        imageInput: false,
      });
      return;
    }
    try {
      const status = await getCodexReadiness(projectRef.current || undefined);
      if (probeRef.current === probe) setReadiness(status);
    } catch {
      if (probeRef.current === probe) {
        setReadiness({
          status: "unavailable",
          message: "Could not check Codex readiness.",
          recovery: "Retry the connection.",
          imageInput: false,
        });
      }
    }
  }, []);

  useEffect(() => {
    projectRef.current = cwd;
    probeRef.current += 1;
    setReadiness(checking);
    const timer = setTimeout(() => void refreshProvider(), 350);
    return () => clearTimeout(timer);
  }, [cwd, refreshProvider]);

  return { readiness, refreshProvider };
}

function useAgentConnection(
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

function useAgentSubmission(
  snapshot: AgentSnapshot,
  setDraft: React.Dispatch<React.SetStateAction<string>>,
) {
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (snapshot.status === "failed" && submitted.current) {
      const wasAccepted = snapshot.messages.some(
        (message) => message.role === "user" && message.text === submitted.current,
      );
      if (!wasAccepted) setDraft((old) => old || submitted.current || "");
      submitted.current = null;
    }
    if (snapshot.status === "completed" || snapshot.status === "stopped") {
      submitted.current = null;
    }
  }, [setDraft, snapshot.messages, snapshot.status]);

  return submitted;
}

function useAgentRequestActions({
  busy,
  cwd,
  draft,
  mode,
  refreshProvider,
  setDraft,
  submitted,
  clearError,
  setRequestError,
}: {
  busy: boolean;
  cwd: string;
  draft: string;
  mode: AgentMode;
  refreshProvider: () => Promise<void>;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  submitted: { current: string | null };
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
}) {
  const send = useCallback(async () => {
    const question = draft.trim();
    if (!question || busy) return;
    clearError();
    submitted.current = question;
    try {
      await askCodex(question, cwd, mode);
      setDraft("");
    } catch (reason) {
      submitted.current = null;
      setRequestError(reason);
      void refreshProvider();
      return;
    }
  }, [busy, clearError, cwd, draft, mode, refreshProvider, setDraft, setRequestError, submitted]);

  const stop = useCallback(async () => {
    clearError();
    try {
      await stopCodex();
    } catch (reason) {
      setRequestError(reason);
    }
  }, [clearError, setRequestError]);

  const decide = useCallback(
    async (approvalId: string, decision: "allowOnce" | "deny") => {
      clearError();
      try {
        await decideAgentApproval(approvalId, decision);
        return true;
      } catch (reason) {
        setRequestError(reason);
        return false;
      }
    },
    [clearError, setRequestError],
  );

  return { send, stop, decide };
}

function useNewAgentSession({
  busy,
  clearError,
  setMode,
  setRequestError,
  submitted,
}: {
  busy: boolean;
  clearError: () => void;
  setMode: React.Dispatch<React.SetStateAction<AgentMode>>;
  setRequestError: (reason: unknown) => void;
  submitted: { current: string | null };
}) {
  return useCallback(async () => {
    if (busy) return false;
    clearError();
    try {
      await newAgentSession();
      submitted.current = null;
      setMode("quickAsk");
      return true;
    } catch (reason) {
      setRequestError(reason);
      return false;
    }
  }, [busy, clearError, setMode, setRequestError, submitted]);
}

export function useAgent() {
  useEffect(() => {
    if (!nativeAvailable) return;
    let shortcut = "Ctrl+Shift+O";
    try {
      shortcut = localStorage.getItem("otto.capture.shortcut") || shortcut;
    } catch {
      // No persisted preference; the native default remains active.
    }
    void configureCaptureShortcut(shortcut).catch(() => {
      // Native capture reports registration conflicts in the Agent surface.
    });
  }, []);
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(initial);
  const [draft, setDraft] = useState("");
  const [cwd, setCwd] = useState("");
  const [mode, setMode] = useState<AgentMode>("quickAsk");
  const busy = ["starting", "streaming", "stopping", "approvalRequired"].includes(snapshot.status);
  const locked = busy || snapshot.threadId !== null;
  const { readiness, refreshProvider } = useProviderReadiness(cwd);
  const installed = readiness.status === "checking" ? null : readiness.status === "ready";
  const receive = useCallback((next: AgentSnapshot) => {
    setSnapshot((prev) => (next.seq >= prev.seq ? next : prev));
  }, []);
  const acceptSnapshot = useCallback(
    (next: AgentSnapshot) => {
      receive(next);
      setCwd((old) => old || next.cwd || "");
      setMode(next.threadId ? next.mode : "quickAsk");
    },
    [receive],
  );
  const connection = useAgentConnection(receive, acceptSnapshot);
  const submitted = useAgentSubmission(snapshot, setDraft);
  const actions = useAgentRequestActions({
    busy,
    cwd,
    draft,
    mode,
    refreshProvider,
    setDraft,
    submitted,
    clearError: connection.clearError,
    setRequestError: connection.setRequestError,
  });
  const newSession = useNewAgentSession({
    busy,
    clearError: connection.clearError,
    setMode,
    setRequestError: connection.setRequestError,
    submitted,
  });

  return {
    snapshot,
    installed,
    readiness,
    draft,
    setDraft,
    cwd,
    setCwd,
    mode,
    setMode,
    locked,
    error: connection.error ?? snapshot.error,
    busy,
    ...actions,
    newSession,
    refreshProvider,
    retryConnection: connection.retryConnection,
    clearError: connection.clearError,
    errorKind: connection.errorKind,
  };
}
