import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  askAgent,
  newAgentChat,
  stopCodex,
  type AgentProvider,
  type AgentSnapshot,
} from "../../platform/tauri/agent";
import { clearAcceptedDraft, restoreRejectedDraft, type SubmittedDraft } from "./draft-state";

type DraftSetter = Dispatch<SetStateAction<string>>;
type SubmittedState = { current: SubmittedDraft | null };

export function useAgentSubmission(
  snapshot: AgentSnapshot,
  setDraft: DraftSetter,
  draftEpoch: RefObject<number>,
) {
  const submitted = useRef<SubmittedDraft | null>(null);
  const [acknowledgedRun, setAcknowledgedRun] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const markAccepted = useCallback((request: SubmittedDraft, runId: number) => {
    if (submitted.current !== request) return false;
    request.acceptedRunId = runId;
    setAcknowledgedRun(runId);
    return true;
  }, []);

  useEffect(() => {
    const pendingRequest = submitted.current;
    if (!pendingRequest || pendingRequest.acceptedRunId !== snapshot.runId) return;
    if (acknowledgedRun !== snapshot.runId) return;
    if (snapshot.status === "failed") {
      const accepted = snapshot.messages.some(
        (message) =>
          message.id === `${snapshot.runId}:user` && message.text === pendingRequest.text.trim(),
      );
      setDraft((current) =>
        restoreRejectedDraft(current, draftEpoch.current, pendingRequest, snapshot.runId, accepted),
      );
      submitted.current = null;
      setPending(false);
    }
    if (snapshot.status === "completed" || snapshot.status === "stopped") {
      submitted.current = null;
      setPending(false);
    }
  }, [acknowledgedRun, draftEpoch, setDraft, snapshot.messages, snapshot.runId, snapshot.status]);

  return { submitted, markAccepted, pending, setPending, clearPending: () => setPending(false) };
}

export function useAgentRequestActions({
  busy,
  draft,
  draftEpoch,
  provider,
  model,
  thinkingEffort,
  refreshProvider,
  setDraft,
  submitted,
  markAccepted,
  setSubmissionPending,
  clearError,
  setRequestError,
}: {
  busy: boolean;
  draft: string;
  draftEpoch: RefObject<number>;
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
  refreshProvider: () => Promise<void>;
  setDraft: DraftSetter;
  submitted: SubmittedState;
  markAccepted: (request: SubmittedDraft, runId: number) => boolean;
  setSubmissionPending: (pending: boolean) => void;
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
}) {
  const send = useCallback(async () => {
    const question = draft.trim();
    if (!question || busy || submitted.current) return;
    clearError();
    const request: SubmittedDraft = {
      text: draft,
      epoch: draftEpoch.current,
      acceptedRunId: null,
    };
    submitted.current = request;
    setSubmissionPending(true);
    try {
      const accepted = await askAgent(question, provider, { model, thinkingEffort });
      if (!markAccepted(request, accepted.runId)) return;
      setDraft((current) => clearAcceptedDraft(current, draftEpoch.current, request));
    } catch (reason) {
      if (submitted.current !== request) return;
      submitted.current = null;
      setSubmissionPending(false);
      setRequestError(reason);
      void refreshProvider();
    }
  }, [
    busy,
    clearError,
    draft,
    draftEpoch,
    markAccepted,
    model,
    provider,
    refreshProvider,
    setDraft,
    setRequestError,
    setSubmissionPending,
    submitted,
    thinkingEffort,
  ]);

  const stop = useCallback(async () => {
    clearError();
    try {
      await stopCodex();
    } catch (reason) {
      setRequestError(reason);
    }
  }, [clearError, setRequestError]);

  return { send, stop };
}

export function useNewAgentChat({
  busy,
  clearError,
  setModelValue,
  setThinkingEffortValue,
  setRequestError,
  submitted,
}: {
  busy: boolean;
  clearError: () => void;
  setModelValue: Dispatch<SetStateAction<string | null>>;
  setThinkingEffortValue: Dispatch<SetStateAction<string | null>>;
  setRequestError: (reason: unknown) => void;
  submitted: SubmittedState;
}) {
  return useCallback(async () => {
    if (busy) return false;
    clearError();
    try {
      await newAgentChat();
      submitted.current = null;
      setModelValue(null);
      setThinkingEffortValue(null);
      return true;
    } catch (reason) {
      setRequestError(reason);
      return false;
    }
  }, [busy, clearError, setModelValue, setRequestError, setThinkingEffortValue, submitted]);
}
