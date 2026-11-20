import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  clearQueuedAgentFollowup,
  queueAgentFollowup,
} from "../../../platform/tauri/agent-controls";
import type {
  AgentProvider,
  AgentSnapshot,
  ProviderReadiness,
} from "../../../platform/tauri/agent-types";
import type { AssistantProfile, LearningMode } from "../../../platform/tauri/agent-guidance";
import { resolveDraftSubmission } from "../model/learning-mode";

type QueuedDraftTracker = {
  runId: number;
  text: string;
};

type FollowupQueueParams = {
  snapshot: AgentSnapshot;
  draft: string;
  provider: AgentProvider;
  readiness: ProviderReadiness;
  model: string | null;
  thinkingEffort: string | null;
  mode: LearningMode;
  profile: AssistantProfile;
  setMode: (mode: LearningMode) => void;
  setDraft: Dispatch<SetStateAction<string>>;
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
};

function messageRunId(id: string): number {
  const [prefix] = id.split(":");
  const parsed = Number.parseInt(prefix, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function useAgentFollowupQueue(params: FollowupQueueParams) {
  const {
    snapshot,
    draft,
    provider,
    readiness,
    model,
    thinkingEffort,
    mode,
    profile,
    setMode,
    setDraft,
    clearError,
    setRequestError,
  } = params;
  const pendingQueued = useRef<QueuedDraftTracker | null>(null);

  useEffect(() => {
    const queued = pendingQueued.current;
    if (!queued) return;
    const dispatched = snapshot.messages.some(
      (message) =>
        message.role === "user" &&
        message.text === queued.text &&
        messageRunId(message.id) > queued.runId,
    );
    if (dispatched || snapshot.status === "idle") {
      pendingQueued.current = null;
      return;
    }
    if (
      (snapshot.status === "stopped" || snapshot.status === "failed") &&
      !snapshot.queuedFollowup
    ) {
      pendingQueued.current = null;
      setDraft((current) => (current.trim().length === 0 ? queued.text : current));
    }
  }, [setDraft, snapshot.messages, snapshot.queuedFollowup, snapshot.status]);

  const queueFollowup = useCallback(async () => {
    if (snapshot.status !== "starting" && snapshot.status !== "streaming") return;
    if (readiness.status !== "ready") return;
    const resolved = resolveDraftSubmission(draft, mode);
    if (resolved.switchedMode) setMode(resolved.switchedMode);
    if (!resolved.question) {
      if (resolved.switchedMode) setDraft("");
      return;
    }
    clearError();
    try {
      const queued = await queueAgentFollowup(resolved.question, provider, {
        model,
        thinkingEffort,
        mode: resolved.activeMode,
        profile,
      });
      pendingQueued.current = { runId: snapshot.runId, text: queued };
      setDraft("");
    } catch (reason) {
      setRequestError(reason);
    }
  }, [
    clearError,
    draft,
    mode,
    model,
    profile,
    provider,
    readiness.status,
    setDraft,
    setMode,
    setRequestError,
    snapshot.runId,
    snapshot.status,
    thinkingEffort,
  ]);

  const clearQueuedFollowup = useCallback(async () => {
    pendingQueued.current = null;
    clearError();
    try {
      await clearQueuedAgentFollowup();
    } catch (reason) {
      setRequestError(reason);
    }
  }, [clearError, setRequestError]);

  return { queueFollowup, clearQueuedFollowup };
}
