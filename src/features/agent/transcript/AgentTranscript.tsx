import { AgentComposer } from "../conversation/AgentComposer";
import { chatActivityLabel } from "../model/status";
import { CaptureAlerts, TranscriptIntro } from "./AgentEmptyState";
import { PermissionChoiceCard } from "./PermissionChoiceCard";
import { resolveTranscriptDisplay } from "./transcript-display";
import { TranscriptMessages } from "./TranscriptMessages";
import { TranscriptOutcome } from "./TranscriptOutcome";
import type { AgentTranscriptModel } from "../model/view-model";
import type { CaptureSource } from "../../../platform/tauri";
import { useTranscriptViewport } from "./useTranscriptViewport";

type AgentTranscriptProps = {
  agent: AgentTranscriptModel;
  onConfigureCapture: () => void;
  onCapture: () => void;
  onCaptureSource?: (source: Exclude<CaptureSource, "selectedText">) => void;
  onStageImage?: (file: File) => void;
  onInsert?: (value: string) => Promise<void>;
  captureActionError: string | null;
  captureSource: CaptureSource;
  reducedMotion?: boolean;
  onMeasured: (height: number) => void;
};

export function AgentTranscript(props: AgentTranscriptProps) {
  const {
    agent,
    onConfigureCapture,
    onCapture,
    onCaptureSource,
    onStageImage,
    onInsert,
    captureActionError,
    captureSource,
    reducedMotion,
    onMeasured,
  } = props;
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
          <TranscriptIntro
            agent={agent}
            showOnboarding={view.showOnboarding}
            showEmptyState={view.showEmptyState}
            reducedMotion={reducedMotion}
          />
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
        onCapture={onCapture}
        send={agent.send}
        stop={agent.stop}
      />
    </>
  );
}
