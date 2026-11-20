import type { LearningMode, StagedCapture } from "../../../platform/tauri";
import { IconButton, Text } from "../../../shared/ui";
import type { CaptureQuickAction } from "../capture/quick-actions";
import { StagedCaptureBar } from "./ComposerCaptureBar";

export function composerPlaceholder(
  stagedCapture: StagedCapture | null,
  busy: boolean,
  queuedFollowup: string | null,
  hasQueueHandler: boolean,
): string {
  if (busy && hasQueueHandler) {
    return queuedFollowup ? "Replace queued follow-up…" : "Queue a follow-up while Otto finishes…";
  }
  return stagedCapture ? "Add a question or press Enter to explain…" : "Ask Otto anything…";
}

export function QueuedFollowupBar({
  text,
  disabled,
  onClear,
}: {
  text: string;
  disabled: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-otto-control border border-otto-line-soft bg-otto-field-deep px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Text
          as="span"
          variant="caption"
          className="shrink-0 rounded-otto-chip border border-otto-line-mid bg-otto-raised-soft px-1.5 py-0.5 text-otto-text-secondary"
        >
          Queued
        </Text>
        <Text as="span" variant="caption" className="min-w-0 truncate text-otto-text-bright">
          {text}
        </Text>
      </div>
      <IconButton
        icon="close"
        size={12}
        label="Remove queued follow-up"
        title="Remove queued follow-up"
        variant="quiet"
        className="h-5 w-5 shrink-0 rounded-full"
        disabled={disabled}
        onClick={onClear}
      />
    </div>
  );
}

export function ComposerAttachments({
  queuedFollowup,
  stagedCapture,
  stopping,
  disabled,
  onClearQueuedFollowup,
  onClearStagedCapture,
  onQuickAction,
}: {
  queuedFollowup: string | null;
  stagedCapture: StagedCapture | null;
  stopping: boolean;
  disabled: boolean;
  onClearQueuedFollowup?: () => Promise<void>;
  onClearStagedCapture?: () => void;
  onQuickAction?: (mode: LearningMode, prompt: string) => void;
}) {
  return (
    <>
      {queuedFollowup && (
        <QueuedFollowupBar
          text={queuedFollowup}
          disabled={stopping}
          onClear={() => void onClearQueuedFollowup?.()}
        />
      )}
      {stagedCapture && (
        <StagedCaptureBar
          staged={stagedCapture}
          disabled={disabled}
          onClear={() => onClearStagedCapture?.()}
          onQuickAction={(action: CaptureQuickAction) =>
            onQuickAction?.(action.mode, action.prompt)
          }
        />
      )}
    </>
  );
}
