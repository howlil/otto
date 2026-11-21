import type { ReactNode } from "react";
import { AgentComposer } from "../conversation/AgentComposer";
import { chatActivityLabel, providerIssue, providerIssueTitle } from "../model/status";
import { AgentEmptyState, CaptureAlerts } from "./AgentEmptyState";
import { PermissionChoiceCard } from "./PermissionChoiceCard";
import { TranscriptMessages } from "./TranscriptMessages";
import { TranscriptOutcome } from "./TranscriptOutcome";
import type { AgentTranscriptModel } from "../model/view-model";
import type { CaptureSource } from "../../../platform/tauri";
import { useTranscriptViewport } from "./useTranscriptViewport";

function resolveTranscriptIssue(agent: AgentTranscriptModel) {
  const { snapshot, readiness, error, errorKind } = agent;
  const runFailure = snapshot.status === "failed" ? snapshot.error : null;
  const displayedErrorKind = errorKind ?? (runFailure ? "request" : null);
  const issueTitle =
    displayedErrorKind === "connection"
      ? "Otto connection unavailable"
      : displayedErrorKind === "request"
        ? "Request failed"
        : providerIssueTitle(readiness);
  const captureFailure =
    snapshot.capture.phase === "failed"
      ? (snapshot.capture.error ?? "Capture could not be completed.")
      : null;
  const issue = providerIssue(readiness, captureFailure ? null : error || runFailure);
  return { displayedErrorKind, issueTitle, captureFailure, issue };
}

function resolveTranscriptDisplay(agent: AgentTranscriptModel) {
  const { snapshot, readiness, draft, captureBusy, busy } = agent;
  const stagedCapture = snapshot.capture.staged ?? null;
  const queuedFollowup = snapshot.queuedFollowup ?? null;
  const issues = resolveTranscriptIssue(agent);
  const canAct = !busy && !captureBusy && readiness.status === "ready";
  const canSend = canAct && (draft.trim().length > 0 || stagedCapture !== null);
  const canQueue =
    busy &&
    snapshot.status !== "stopping" &&
    !captureBusy &&
    readiness.status === "ready" &&
    draft.trim().length > 0;
  const showEmptyState =
    snapshot.messages.length === 0 &&
    snapshot.status === "idle" &&
    canAct &&
    !issues.issue &&
    !issues.captureFailure &&
    !stagedCapture;
  return { stagedCapture, queuedFollowup, ...issues, canAct, canSend, canQueue, showEmptyState };
}

export function AgentTranscript({
  agent,
  onConfigureCapture,
  onCapture,
  onCaptureSource,
  onStageImage,
  onInsert,
  captureActionError,
  captureSource,
  captureShortcut,
  voiceControl,
  speakingMessageId,
  onToggleSpeak,
  onMeasured,
}: {
  agent: AgentTranscriptModel;
  onConfigureCapture: () => void;
  onCapture: () => void;
  onCaptureSource?: (source: Exclude<CaptureSource, "selectedText">) => void;
  onStageImage?: (file: File) => void;
  onInsert?: (value: string) => Promise<void>;
  captureActionError: string | null;
  captureSource: CaptureSource;
  captureShortcut?: string;
  voiceControl?: ReactNode;
  speakingMessageId?: string | null;
  onToggleSpeak?: (messageId: string, text: string) => void;
  onMeasured: (height: number) => void;
}) {
  const { feed, composer, onFeedScroll } = useTranscriptViewport({
    onMeasured,
    captureActionError,
    seq: agent.snapshot.seq,
  });
  const view = resolveTranscriptDisplay(agent);

  return (
    <>
      <div
        className="otto-scrollbar-hidden min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[18px] pb-[9px] pt-[7px] [overscroll-behavior:contain]"
        ref={feed}
        role="log"
        onScroll={onFeedScroll}
      >
        <div className="flex min-w-0 flex-col gap-[11px]">
          {view.showEmptyState && (
            <AgentEmptyState
              captureShortcut={captureShortcut}
              onSelectStarter={(mode, prompt) => {
                agent.setMode?.(mode);
                agent.setDraft(prompt);
                document.getElementById("otto-prompt")?.focus({ preventScroll: true });
              }}
            />
          )}
          <TranscriptMessages
            snapshot={agent.snapshot}
            busy={agent.busy}
            canAct={view.canAct}
            activity={chatActivityLabel(
              agent.snapshot.status,
              agent.snapshot.capture.phase,
              agent.readiness.status,
            )}
            onInsert={onInsert}
            speakingMessageId={speakingMessageId}
            onToggleSpeak={onToggleSpeak}
            onRetry={agent.retryLast}
            onEditPrompt={agent.editPrompt}
            onFollowupChip={agent.sendFollowupChip}
          />
          {agent.snapshot.pendingPermission && (
            <PermissionChoiceCard
              permission={agent.snapshot.pendingPermission}
              onRespond={agent.respondPermission}
            />
          )}
          <TranscriptOutcome
            snapshot={agent.snapshot}
            canRetry={view.canAct}
            onRetry={agent.retryLast}
            issue={view.issue}
            issueTitle={view.issueTitle}
            errorKind={view.displayedErrorKind}
            retryConnection={agent.retryConnection}
            refreshProvider={agent.refreshProvider}
            clearError={agent.clearError}
          />
        </div>
      </div>
      <CaptureAlerts
        captureFailure={view.captureFailure}
        captureActionError={captureActionError}
        captureSource={captureSource}
        onCapture={onCapture}
        onConfigureCapture={onConfigureCapture}
      />
      <AgentComposer
        composerRef={composer}
        imageTransport={agent.readiness.imageTransport}
        captureSource={captureSource}
        provider={agent.snapshot.provider}
        draft={agent.draft}
        setDraft={agent.setDraft}
        mode={agent.mode ?? "direct"}
        onModeChange={agent.setMode}
        stagedCapture={view.stagedCapture}
        onClearStagedCapture={() => void agent.clearStaged?.()}
        onQuickAction={(quickMode, quickPrompt) =>
          void agent.runQuickAction?.(quickMode, quickPrompt)
        }
        onStageImage={onStageImage}
        onCaptureSource={onCaptureSource}
        queuedFollowup={view.queuedFollowup}
        canQueue={view.canQueue}
        onQueueFollowup={agent.queueFollowup}
        onClearQueuedFollowup={agent.clearQueuedFollowup}
        busy={agent.busy}
        captureBusy={agent.captureBusy}
        capturePhase={agent.snapshot.capture.phase}
        canSend={view.canSend}
        stopping={agent.snapshot.status === "stopping"}
        voiceControl={voiceControl}
        onCapture={onCapture}
        send={agent.send}
        stop={agent.stop}
      />
    </>
  );
}
