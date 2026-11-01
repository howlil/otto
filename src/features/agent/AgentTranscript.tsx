import { AgentComposer } from "./AgentComposer";
import { capturePhaseLabel, providerIssue, providerIssueTitle } from "./status";
import { TranscriptMessages } from "./TranscriptMessages";
import { TranscriptOutcome } from "./TranscriptOutcome";
import type { AgentTranscriptModel } from "./view-model";
import { useTranscriptViewport } from "./useTranscriptViewport";

export function AgentTranscript({
  agent,
  denied,
  approvalPending,
  onDenied,
  onConfigureCapture,
  onCapture,
  captureActionError,
  onMeasured,
}: {
  agent: AgentTranscriptModel;
  denied: boolean;
  approvalPending: boolean;
  onDenied: () => void;
  onConfigureCapture: () => void;
  onCapture: () => void;
  captureActionError: string | null;
  onMeasured: (height: number) => void;
}) {
  const {
    snapshot,
    readiness,
    draft,
    setDraft,
    error,
    errorKind,
    captureBusy,
    busy,
    send,
    stop,
    decide,
    refreshProvider,
    retryConnection,
    clearError,
  } = agent;
  const { feed, composer, onFeedScroll } = useTranscriptViewport({
    onMeasured,
    captureActionError,
    seq: snapshot.seq,
  });

  const canSend = !busy && !captureBusy && readiness.status === "ready" && draft.trim().length > 0;
  const approval = snapshot.approval;
  const issueTitle =
    errorKind === "connection"
      ? "Otto connection unavailable"
      : errorKind === "request"
        ? "Request failed"
        : providerIssueTitle(readiness);
  const captureFailure =
    snapshot.capture.phase === "failed"
      ? (snapshot.capture.error ?? "Screen capture could not be completed.")
      : null;
  const issue = providerIssue(readiness, captureFailure ? null : error);
  return (
    <>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[18px] pb-[9px] pt-[7px] [overscroll-behavior:contain] [scrollbar-width:none]"
        ref={feed}
        role="log"
        onScroll={onFeedScroll}
      >
        <div className="flex min-w-0 flex-col gap-[11px]">
          <TranscriptMessages snapshot={snapshot} busy={busy} />
          <TranscriptOutcome
            approval={approval}
            approvalPending={approvalPending}
            denied={denied}
            onDenied={onDenied}
            decide={decide}
            snapshot={snapshot}
            issue={issue}
            issueTitle={issueTitle}
            errorKind={errorKind}
            retryConnection={retryConnection}
            refreshProvider={refreshProvider}
            clearError={clearError}
          />
        </div>
      </div>
      {captureBusy && (
        <div role="status" className="mx-[18px] mb-1 text-otto-xs text-otto-text-tertiary">
          {capturePhaseLabel(snapshot.capture.phase)}…
        </div>
      )}
      {captureFailure && (
        <div role="alert" className="mx-[18px] mb-1 text-otto-xs text-otto-danger">
          {captureFailure}{" "}
          <button type="button" className="underline" onClick={onCapture}>
            Retry capture
          </button>{" "}
          <button type="button" className="underline" onClick={onConfigureCapture}>
            Screen Capture settings
          </button>
        </div>
      )}
      {captureActionError && (
        <div role="alert" className="mx-[18px] mb-1 text-otto-xs text-otto-danger">
          {captureActionError}{" "}
          <button type="button" className="underline" onClick={onConfigureCapture}>
            Screen Capture settings
          </button>
        </div>
      )}
      <AgentComposer
        composerRef={composer}
        imageTransport={readiness.imageTransport}
        provider={snapshot.provider}
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        captureBusy={captureBusy}
        capturePhase={snapshot.capture.phase}
        approvalPending={approvalPending}
        canSend={canSend}
        stopping={snapshot.status === "stopping"}
        onCapture={onCapture}
        send={send}
        stop={stop}
      />
    </>
  );
}
