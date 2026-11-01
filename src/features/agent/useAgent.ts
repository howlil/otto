import { useCallback, useEffect, useRef, useState } from "react";
import { useCaptureSource } from "./useCaptureSource";
import { clearAcceptedDraft, restoreRejectedDraft, type SubmittedDraft } from "./draft-state";
import {
  askAgent,
  getAgentReadiness,
  getCaptureTargetTitle,
  selectAgentProvider,
  configureCaptureShortcut,
  nativeAvailable,
  decideAgentApproval,
  getAgentSnapshot,
  newAgentSession,
  stopCodex,
  subscribeAgent,
  type AgentMode,
  type AgentProvider,
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

const initial: AgentSnapshot = {
  runId: 0,
  seq: 0,
  status: "idle",
  mode: "quickAsk",
  provider: "codex",
  cwd: "",
  threadId: null,
  messages: [],
  error: null,
};

const checking: ProviderReadiness = {
  status: "checking",
  message: "Checking provider…",
  recovery: "",
  imageInput: false,
};

function useProviderReadiness(cwd: string, provider: AgentProvider) {
  const [readiness, setReadiness] = useState<ProviderReadiness>(checking);
  const projectRef = useRef("");
  const providerRef = useRef<AgentProvider>("codex");
  const probeRef = useRef(0);

  const refreshProvider = useCallback(async () => {
    const probe = ++probeRef.current;
    setReadiness(checking);
    if (!nativeAvailable) {
      setReadiness({
        status: "unavailable",
        message: "Provider readiness requires the Otto desktop app.",
        recovery: "Open Otto on Windows.",
        imageInput: false,
      });
      return;
    }
    try {
      const status = await getAgentReadiness(providerRef.current, projectRef.current || undefined);
      if (probeRef.current === probe) setReadiness(status);
    } catch {
      if (probeRef.current === probe) {
        setReadiness({
          status: "unavailable",
          message: "Could not check provider readiness.",
          recovery: "Retry the connection.",
          imageInput: false,
        });
      }
    }
  }, []);

  useEffect(() => {
    projectRef.current = cwd;
    providerRef.current = provider;
    probeRef.current += 1;
    setReadiness(checking);
    const timer = setTimeout(() => void refreshProvider(), 350);
    return () => clearTimeout(timer);
  }, [cwd, provider, refreshProvider]);

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
  draftEpoch: React.RefObject<number>,
) {
  const submitted = useRef<SubmittedDraft | null>(null);

  useEffect(() => {
    const pending = submitted.current;
    if (snapshot.status === "failed" && pending && snapshot.runId > pending.previousRunId) {
      const accepted = snapshot.messages.some(
        (message) => message.id === `${snapshot.runId}:user` && message.text === pending.text.trim(),
      );
      setDraft((current) =>
        restoreRejectedDraft(current, draftEpoch.current, pending, snapshot.runId, accepted),
      );
      submitted.current = null;
    }
    if (snapshot.status === "completed" || snapshot.status === "stopped") {
      submitted.current = null;
    }
  }, [draftEpoch, setDraft, snapshot.messages, snapshot.runId, snapshot.status]);

  return submitted;
}

function useAgentRequestActions({
  busy,
  cwd,
  draft,
  draftEpoch,
  runId,
  mode,
  provider,
  refreshProvider,
  setDraft,
  submitted,
  clearError,
  setRequestError,
}: {
  busy: boolean;
  cwd: string;
  draft: string;
  draftEpoch: React.RefObject<number>;
  runId: number;
  mode: AgentMode;
  provider: AgentProvider;
  refreshProvider: () => Promise<void>;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  submitted: { current: SubmittedDraft | null };
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
}) {
  const send = useCallback(async () => {
    const question = draft.trim();
    if (!question || busy || submitted.current) return;
    clearError();
    const request: SubmittedDraft = { text: draft, epoch: draftEpoch.current, previousRunId: runId };
    submitted.current = request;
    try {
      await askAgent(question, cwd, mode, provider);
      setDraft((current) => clearAcceptedDraft(current, draftEpoch.current, request));
    } catch (reason) {
      if (submitted.current === request) submitted.current = null;
      setRequestError(reason);
      void refreshProvider();
      return;
    }
  }, [
    busy,
    clearError,
    cwd,
    draft,
    draftEpoch,
    runId,
    mode,
    provider,
    refreshProvider,
    setDraft,
    setRequestError,
    submitted,
  ]);

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
  submitted: { current: SubmittedDraft | null };
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

function useCaptureShortcut() {
  const [captureMessage, setCaptureMessage] = useState("");
  const [targetTitle, setTargetTitle] = useState<string | null>(null);
  const [targetWarning, setTargetWarning] = useState<string | null>(null);
  const [targetPending, setTargetPending] = useState(false);
  const { source, selectSource, sourceReady, sourcePending } = useCaptureSource(setCaptureMessage);
  const [shortcut, setShortcut] = useState(() => {
    try {
      return localStorage.getItem("otto.capture.shortcut") || "Ctrl+Shift+O";
    } catch {
      return "Ctrl+Shift+O";
    }
  });
  const [savingCapture, setSavingCapture] = useState(false);
  const refreshTarget = useCallback(async () => {
    if (!nativeAvailable) return;
    setTargetPending(true);
    try {
      const title = await getCaptureTargetTitle();
      setTargetTitle(title);
      setTargetWarning(null);
    } catch (cause) {
      setTargetTitle(null);
      setTargetWarning(String(cause));
    } finally {
      setTargetPending(false);
    }
  }, []);
  const registeredShortcut = useRef(shortcut);
  const registered = useRef(false);

  useEffect(() => {
    if (!nativeAvailable || !sourceReady || registered.current) return;
    registered.current = true;
    setSavingCapture(true);
    void configureCaptureShortcut(registeredShortcut.current)
      .catch((cause: unknown) => {
        registered.current = false;
        setCaptureMessage(String(cause));
      })
      .finally(() => setSavingCapture(false));
  }, [sourceReady]);

  const saveShortcut = useCallback(async () => {
    if (!nativeAvailable || !sourceReady || sourcePending || savingCapture) return;
    setSavingCapture(true);
    try {
      await configureCaptureShortcut(shortcut);
      registeredShortcut.current = shortcut;
      registered.current = true;
      try {
        localStorage.setItem("otto.capture.shortcut", shortcut);
        setCaptureMessage("Shortcut active. Focus another app and press it to capture.");
      } catch {
        setCaptureMessage("Shortcut active; preference could not be saved for next launch.");
      }
    } catch (cause) {
      setCaptureMessage(String(cause));
    } finally {
      setSavingCapture(false);
    }
  }, [shortcut, sourceReady, sourcePending, savingCapture]);

  return {
    source,
    selectSource,
    targetTitle,
    targetWarning,
    targetPending,
    refreshTarget,
    sourceReady,
    sourcePending,
    shortcut,
    setShortcut,
    captureMessage,
    savingCapture,
    available: nativeAvailable,
    saveShortcut,
  };
}

export function useAgent() {
  const capture = useCaptureShortcut();
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(initial);
  const [draft, setDraft] = useState("");
  const draftEpoch = useRef(0);
  const editDraft = useCallback((value: string) => {
    draftEpoch.current += 1;
    setDraft(value);
  }, []);
  const [cwd, setCwd] = useState("");
  const [mode, setMode] = useState<AgentMode>("quickAsk");
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const changingProvider = useRef(false);
  const busy = ["starting", "streaming", "stopping", "approvalRequired"].includes(snapshot.status);
  const locked = busy || snapshot.threadId !== null;
  const { readiness, refreshProvider } = useProviderReadiness(cwd, provider);
  const installed = readiness.status === "checking" ? null : readiness.status === "ready";
  const receive = useCallback((next: AgentSnapshot) => {
    setSnapshot((prev) => (next.seq >= prev.seq ? next : prev));
  }, []);
  const acceptSnapshot = useCallback(
    (next: AgentSnapshot) => {
      receive(next);
      setCwd((old) => old || next.cwd || "");
      setProvider(next.provider);
      setMode(next.threadId ? next.mode : "quickAsk");
    },
    [receive],
  );
  const connection = useAgentConnection(receive, acceptSnapshot);
  const selectProvider = useCallback(
    async (next: AgentProvider) => {
      if (locked || changingProvider.current || next === provider) return;
      changingProvider.current = true;
      try {
        if (nativeAvailable) await selectAgentProvider(next);
        setProvider(next);
        if (next !== "codex") setMode("quickAsk");
        connection.clearError();
      } catch (error) {
        connection.setRequestError(error);
      } finally {
        changingProvider.current = false;
      }
    },
    [locked, provider, connection.clearError, connection.setRequestError],
  );
  const submitted = useAgentSubmission(snapshot, setDraft, draftEpoch);
  const actions = useAgentRequestActions({
    busy,
    cwd,
    draft,
    draftEpoch,
    runId: snapshot.runId,
    mode,
    provider,
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
    capture,
    draft,
    setDraft: editDraft,
    cwd,
    setCwd,
    mode,
    setMode,
    provider,
    setProvider: selectProvider,
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
