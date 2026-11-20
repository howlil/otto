import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { askAgent } from "../../../platform/tauri/agent";
import {
  editAndRerunAgentTurn,
  respondAgentPermission,
  retryAgentLastTurn,
} from "../../../platform/tauri/agent-controls";
import type {
  AcceptedAgentRun,
  AgentProvider,
  AgentSnapshot,
  ProviderReadiness,
} from "../../../platform/tauri/agent-types";
import type { AssistantProfile, LearningMode } from "../../../platform/tauri/agent-guidance";
import type { SubmittedDraft } from "../model/draft-state";
import { useAgentFollowupQueue } from "./useAgentFollowupQueue";

type DraftSetter = Dispatch<SetStateAction<string>>;
type SubmittedState = { current: SubmittedDraft | null };

export type TurnControlsParams = {
  snapshot: AgentSnapshot;
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
  refreshProvider: () => Promise<void>;
  setDraft: DraftSetter;
  submitted: SubmittedState;
  markAccepted: (request: SubmittedDraft, runId: number) => boolean;
  setSubmissionPending: (pending: boolean) => void;
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
};

function useTrackedTurn(params: TurnControlsParams) {
  const {
    busy,
    isRuntimePending,
    readiness,
    draftEpoch,
    submitted,
    markAccepted,
    setSubmissionPending,
    clearError,
    setRequestError,
    refreshProvider,
  } = params;
  return useCallback(
    async (requestText: string, invokeTurn: () => Promise<AcceptedAgentRun>) => {
      if (busy || isRuntimePending() || submitted.current || readiness.status !== "ready") return;
      clearError();
      const request: SubmittedDraft = {
        text: requestText,
        epoch: draftEpoch.current,
        acceptedRunId: null,
      };
      submitted.current = request;
      setSubmissionPending(true);
      try {
        const accepted = await invokeTurn();
        markAccepted(request, accepted.runId);
      } catch (reason) {
        if (submitted.current !== request) return;
        submitted.current = null;
        setSubmissionPending(false);
        setRequestError(reason);
        void refreshProvider();
      }
    },
    [
      busy,
      clearError,
      draftEpoch,
      isRuntimePending,
      markAccepted,
      readiness.status,
      refreshProvider,
      setRequestError,
      setSubmissionPending,
      submitted,
    ],
  );
}

export function useAgentTurnControls(params: TurnControlsParams) {
  const {
    snapshot,
    provider,
    model,
    thinkingEffort,
    mode,
    profile,
    setMode,
    clearError,
    setRequestError,
  } = params;
  const runTrackedTurn = useTrackedTurn(params);
  const queue = useAgentFollowupQueue(params);

  const retryLast = useCallback(async () => {
    const lastUser = [...snapshot.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    await runTrackedTurn(lastUser.text, () =>
      retryAgentLastTurn(provider, { model, thinkingEffort, mode, profile }),
    );
  }, [mode, model, profile, provider, runTrackedTurn, snapshot.messages, thinkingEffort]);

  const editPrompt = useCallback(
    async (messageId: string, nextText: string) => {
      const trimmed = nextText.trim();
      if (!trimmed) return;
      await runTrackedTurn(trimmed, () =>
        editAndRerunAgentTurn(messageId, trimmed, provider, {
          model,
          thinkingEffort,
          mode,
          profile,
        }),
      );
    },
    [mode, model, profile, provider, runTrackedTurn, thinkingEffort],
  );

  const sendFollowupChip = useCallback(
    async (chipMode: LearningMode, chipPrompt: string) => {
      setMode(chipMode);
      await runTrackedTurn(chipPrompt, () =>
        askAgent(chipPrompt, provider, { model, thinkingEffort, mode: chipMode, profile }),
      );
    },
    [model, profile, provider, runTrackedTurn, setMode, thinkingEffort],
  );

  const respondPermission = useCallback(
    async (requestId: string, allow: boolean) => {
      clearError();
      try {
        await respondAgentPermission(requestId, allow);
      } catch (reason) {
        setRequestError(reason);
      }
    },
    [clearError, setRequestError],
  );

  return { retryLast, editPrompt, sendFollowupChip, respondPermission, ...queue };
}
