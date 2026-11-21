import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  askAgent,
  stopAgent,
  type AgentProvider,
  type ProviderReadiness,
} from "../../../platform/tauri/agent";
import type { AssistantProfile, LearningMode } from "../../../platform/tauri/agent-guidance";
import type { StagedCapture } from "../../../platform/tauri/capture";
import { defaultPromptForStagedCapture } from "../capture/quick-actions";
import { clearAcceptedDraft, type SubmittedDraft } from "../model/draft-state";
import { resolveDraftSubmission } from "../model/learning-mode";

export { useAgentSubmission, useNewAgentChat } from "./useNewAgentChat";

type DraftSetter = Dispatch<SetStateAction<string>>;
type SubmittedState = { current: SubmittedDraft | null };

type RequestActionParams = {
  busy: boolean;
  isRuntimePending: () => boolean;
  draft: string;
  draftEpoch: RefObject<number>;
  provider: AgentProvider;
  readiness: ProviderReadiness;
  model: string | null;
  thinkingEffort: string | null;
  mode: LearningMode;
  profile: AssistantProfile;
  setMode: (mode: LearningMode) => void;
  stagedCapture?: StagedCapture | null;
  refreshProvider: () => Promise<void>;
  setDraft: DraftSetter;
  submitted: SubmittedState;
  markAccepted: (request: SubmittedDraft, runId: number) => boolean;
  setSubmissionPending: (pending: boolean) => void;
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
};

export function useAgentRequestActions(params: RequestActionParams) {
  const {
    busy,
    isRuntimePending,
    draft,
    draftEpoch,
    provider,
    readiness,
    model,
    thinkingEffort,
    mode,
    profile,
    setMode,
    stagedCapture,
    refreshProvider,
    setDraft,
    submitted,
    markAccepted,
    setSubmissionPending,
    clearError,
    setRequestError,
  } = params;

  const dispatchAsk = useCallback(
    async (question: string, requestText: string, activeMode: LearningMode) => {
      clearError();
      const request: SubmittedDraft = {
        text: requestText,
        epoch: draftEpoch.current,
        acceptedRunId: null,
      };
      submitted.current = request;
      setSubmissionPending(true);
      try {
        const accepted = await askAgent(question, provider, {
          model,
          thinkingEffort,
          mode: activeMode,
          profile,
        });
        if (!markAccepted(request, accepted.runId)) return;
        setDraft((current) => clearAcceptedDraft(current, draftEpoch.current, request));
      } catch (reason) {
        if (submitted.current !== request) return;
        submitted.current = null;
        setSubmissionPending(false);
        setRequestError(reason);
        void refreshProvider();
      }
    },
    [
      clearError,
      draftEpoch,
      markAccepted,
      model,
      profile,
      provider,
      refreshProvider,
      setDraft,
      setRequestError,
      setSubmissionPending,
      submitted,
      thinkingEffort,
    ],
  );

  const sendText = useCallback(
    async (rawText: string) => {
      const resolved = resolveDraftSubmission(rawText, mode);
      if (resolved.switchedMode) setMode(resolved.switchedMode);
      const question =
        resolved.question || (stagedCapture ? defaultPromptForStagedCapture(stagedCapture) : "");
      if (!question) {
        if (resolved.switchedMode) setDraft("");
        return;
      }
      if (busy || isRuntimePending() || submitted.current || readiness.status !== "ready") return;
      await dispatchAsk(question, resolved.requestText || question, resolved.activeMode);
    },
    [
      busy,
      dispatchAsk,
      isRuntimePending,
      mode,
      readiness.status,
      setDraft,
      setMode,
      stagedCapture,
      submitted,
    ],
  );

  const send = useCallback(async () => {
    await sendText(draft);
  }, [draft, sendText]);

  const runQuickAction = useCallback(
    async (actionMode: LearningMode, actionPrompt: string) => {
      if (busy || isRuntimePending() || submitted.current || readiness.status !== "ready") return;
      setMode(actionMode);
      const custom = draft.trim();
      const question = custom ? `${actionPrompt}\n\n${custom}` : actionPrompt;
      await dispatchAsk(question, draft || question, actionMode);
    },
    [busy, dispatchAsk, draft, isRuntimePending, readiness.status, setMode, submitted],
  );

  const stop = useCallback(async () => {
    clearError();
    try {
      await stopAgent();
    } catch (reason) {
      setRequestError(reason);
    }
  }, [clearError, setRequestError]);

  return { send, sendText, runQuickAction, stop };
}
