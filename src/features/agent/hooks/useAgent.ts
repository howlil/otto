import { useCallback, useRef, useState } from "react";
import { useAgentCapture } from "../capture/useAgentCapture";
import { captureIsWorking } from "../model/status";
import { useAgentHistory } from "../history/useAgentHistory";
import { useCaptureShortcut } from "../capture/useCaptureShortcut";
import { useAgentConnection } from "./useAgentConnection";
import { useAgentGuidance } from "./useAgentGuidance";
import { useAgentRequestActions, useAgentSubmission, useNewAgentChat } from "./useAgentRequests";
import { useProviderReadiness } from "./useAgentReadiness";
import { useAgentRuntimeActions } from "./useAgentRuntimeActions";
import { useAgentRuntimePrefs } from "./useAgentRuntimePrefs";
import { useAgentTurnControls } from "./useAgentTurnControls";
import type { AgentProvider, AgentSnapshot } from "../../../platform/tauri/agent";
import type { AgentViewModel } from "../model/view-model";

export type { AgentErrorKind, AgentViewModel } from "../model/view-model";

const initial: AgentSnapshot = {
  runId: 0,
  seq: 0,
  status: "idle",
  provider: "codex",
  threadId: null,
  model: null,
  thinkingEffort: null,
  usage: null,
  rateLimits: [],
  messages: [],
  activity: [],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
};

export function useAgent(readinessActive: boolean): AgentViewModel {
  const capture = useCaptureShortcut();
  const { captureNow, insertText, stageImage, clearStaged } = useAgentCapture();
  const guidance = useAgentGuidance();
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(initial);
  const [draft, setDraft] = useState("");
  const draftEpoch = useRef(0);
  const editDraft = useCallback((value: string) => {
    draftEpoch.current += 1;
    setDraft(value);
  }, []);
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const providerRef = useRef<AgentProvider>(provider);
  const updateProvider = useCallback(
    (next: AgentProvider | ((current: AgentProvider) => AgentProvider)) => {
      setProvider((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        providerRef.current = resolved;
        return resolved;
      });
    },
    [],
  );
  const [model, setModelValue] = useState<string | null>(null);
  const [thinkingEffort, setThinkingEffortValue] = useState<string | null>(null);
  const activeRun = ["starting", "streaming", "stopping"].includes(snapshot.status);
  const captureBusy = captureIsWorking(snapshot.capture.phase);
  const { readiness, refreshing, providers, refreshProvider, refreshPath } = useProviderReadiness(
    provider,
    model,
    readinessActive,
  );
  const runtimePrefs = useAgentRuntimePrefs();
  const pinnedModels = runtimePrefs.prefs.pinnedModels[provider] ?? [];
  const togglePinnedModel = useCallback(
    (modelId: string) => runtimePrefs.togglePinnedModel(provider, modelId),
    [provider, runtimePrefs.togglePinnedModel],
  );
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
      providerRef.current = next.provider;
      setProvider(next.provider);
      setModelValue(next.model);
      setThinkingEffortValue(next.thinkingEffort);
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
    prefs: runtimePrefs.prefs,
    blocked: activeRun || submissionPending || captureBusy,
    setProvider: updateProvider,
    setModel: setModelValue,
    setThinkingEffort: setThinkingEffortValue,
    recordSelection: runtimePrefs.recordSelection,
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
  const requestShared = {
    busy: operationBusy,
    isRuntimePending: runtime.isPending,
    draft,
    draftEpoch,
    provider,
    readiness,
    model,
    thinkingEffort,
    mode: guidance.mode,
    profile: guidance.profile,
    setMode: guidance.setMode,
    refreshProvider,
    setDraft,
    submitted,
    markAccepted,
    setSubmissionPending,
    clearError: connection.clearError,
    setRequestError: connection.setRequestError,
  };
  const actions = useAgentRequestActions({
    ...requestShared,
    stagedCapture: snapshot.capture.staged ?? null,
  });
  const turnControls = useAgentTurnControls({ ...requestShared, snapshot });
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
    refreshing,
    pinnedModels,
    togglePinnedModel,
    providers,
    capture,
    captureNow,
    insertText,
    stageImage,
    clearStaged,
    history,
    draft,
    setDraft: editDraft,
    provider,
    model,
    thinkingEffort,
    setProvider: runtime.selectProvider,
    setModel: runtime.selectModel,
    setThinkingEffort: runtime.selectThinkingEffort,
    mode: guidance.mode,
    setMode: guidance.setMode,
    profile: guidance.profile,
    setProfile: guidance.setProfile,
    clearProfile: guidance.clearProfile,
    locked,
    error: connection.error ?? snapshot.error,
    busy: operationBusy,
    captureBusy,
    ...actions,
    ...turnControls,
    newSession,
    refreshProvider,
    refreshPath,
    retryConnection: connection.retryConnection,
    clearError: connection.clearError,
    errorKind: connection.errorKind,
  };
}
