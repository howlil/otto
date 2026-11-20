import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { newAgentChat, type AgentSnapshot } from "../../../platform/tauri/agent";
import { restoreRejectedDraft, type SubmittedDraft } from "../model/draft-state";

type DraftSetter = Dispatch<SetStateAction<string>>;

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

type NewChatParams = {
  busy: boolean;
  isRuntimePending: () => boolean;
  clearError: () => void;
  setModelValue: Dispatch<SetStateAction<string | null>>;
  setThinkingEffortValue: Dispatch<SetStateAction<string | null>>;
  setRequestError: (reason: unknown) => void;
  submitted: { current: SubmittedDraft | null };
};

export function useNewAgentChat(params: NewChatParams) {
  const {
    busy,
    isRuntimePending,
    clearError,
    setModelValue,
    setThinkingEffortValue,
    setRequestError,
    submitted,
  } = params;

  return useCallback(async () => {
    if (busy || isRuntimePending()) return false;
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
  }, [
    busy,
    clearError,
    isRuntimePending,
    setModelValue,
    setRequestError,
    setThinkingEffortValue,
    submitted,
  ]);
}
