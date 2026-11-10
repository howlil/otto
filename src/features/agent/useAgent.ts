import { useCallback, useRef, useState } from "react";
import { captureIsWorking } from "./status";
import { useAgentHistory } from "./useAgentHistory";
import { useCaptureShortcut } from "./useCaptureShortcut";
import {
  useAgentConnection,
  useAgentRequestActions,
  useAgentRuntimeActions,
  useAgentSubmission,
  useNewAgentChat,
  useProviderReadiness,
} from "./runtime";
import { captureAgentNow } from "../../platform/tauri/capture";
import type { AgentProvider, AgentSnapshot } from "../../platform/tauri/agent";

export type { AgentErrorKind } from "./runtime";

const initial: AgentSnapshot = {
  runId: 0,
  seq: 0,
  status: "idle",
  provider: "codex",
  threadId: null,
  model: null,
  thinkingEffort: null,
  usage: null,
  messages: [],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
};

export function useAgent(readinessActive: boolean) {
  const capture = useCaptureShortcut();
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(initial);
  const [draft, setDraft] = useState("");
  const draftEpoch = useRef(0);
  const editDraft = useCallback((value: string) => {
    draftEpoch.current += 1;
    setDraft(value);
  }, []);
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [model, setModelValue] = useState<string | null>(null);
  const [thinkingEffort, setThinkingEffortValue] = useState<string | null>(null);
  const activeRun = ["starting", "streaming", "stopping"].includes(snapshot.status);
  const captureBusy = captureIsWorking(snapshot.capture.phase);
  const { readiness, refreshProvider } = useProviderReadiness(provider, model, readinessActive);
  const installed = readiness.status === "checking" ? null : readiness.status === "ready";
  const sequence = useRef(-1);
  const receive = useCallback((next: AgentSnapshot) => {
    if (next.seq < sequence.current) return false;
    sequence.current = next.seq;
    setSnapshot(next);
    return true;
  }, []);
  const acceptSnapshot = useCallback(
    (next: AgentSnapshot) => {
      if (!receive(next)) return;
      setProvider(next.provider);
      setModelValue((current) => next.model ?? current);
      setThinkingEffortValue((current) => next.thinkingEffort ?? current);
    },
    [receive],
  );
  const connection = useAgentConnection(receive, acceptSnapshot);
  const {
    submitted,
    markAccepted,
    pending: submissionPending,
    setPending: setSubmissionPending,
    clearPending,
  } = useAgentSubmission(snapshot, setDraft, draftEpoch);
  const runtime = useAgentRuntimeActions({
    provider,
    model,
    readiness,
    blocked: activeRun || submissionPending || captureBusy,
    setProvider,
    setModel: setModelValue,
    setThinkingEffort: setThinkingEffortValue,
    clearError: connection.clearError,
    setRequestError: connection.setRequestError,
  });
  const busy = activeRun || runtime.pending;
  const operationBusy = busy || submissionPending;
  const locked = operationBusy || captureBusy;
  const onHistoryOpened = useCallback(
    (next: AgentSnapshot) => {
      submitted.current = null;
      clearPending();
      acceptSnapshot(next);
    },
    [acceptSnapshot, clearPending, submitted],
  );
  const history = useAgentHistory({ onOpened: onHistoryOpened });
  const actions = useAgentRequestActions({
    busy: operationBusy,
    isRuntimePending: runtime.isPending,
    draft,
    draftEpoch,
    provider,
    readiness,
    model,
    thinkingEffort,
    refreshProvider,
    setDraft,
    submitted,
    markAccepted,
    setSubmissionPending,
    clearError: connection.clearError,
    setRequestError: connection.setRequestError,
  });
  const newSession = useNewAgentChat({
    busy: operationBusy,
    isRuntimePending: runtime.isPending,
    clearError: connection.clearError,
    setModelValue,
    setThinkingEffortValue,
    setRequestError: connection.setRequestError,
    submitted,
  });

  return {
    snapshot,
    installed,
    readiness,
    capture,
    captureNow: captureAgentNow,
    history,
    draft,
    setDraft: editDraft,
    provider,
    model,
    thinkingEffort,
    setProvider: runtime.selectProvider,
    setModel: runtime.selectModel,
    setThinkingEffort: runtime.selectThinkingEffort,
    locked,
    error: connection.error ?? snapshot.error,
    busy: operationBusy,
    captureBusy,
    ...actions,
    newSession,
    refreshProvider,
    retryConnection: connection.retryConnection,
    clearError: connection.clearError,
    errorKind: connection.errorKind,
  };
}
