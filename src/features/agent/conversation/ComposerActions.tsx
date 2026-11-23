import type { ReactNode } from "react";
import { IconButton } from "../../../shared/ui";

export function SubmitControl({
  busy,
  stopping,
  canSend,
  canQueue = false,
  onQueueFollowup,
  stop,
}: {
  busy: boolean;
  stopping: boolean;
  canSend: boolean;
  canQueue?: boolean;
  onQueueFollowup?: () => Promise<void>;
  stop: () => Promise<void>;
}) {
  if (busy) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        {onQueueFollowup && canQueue && (
          <IconButton
            icon="queue"
            size={14}
            label="Queue follow-up"
            variant="outlined"
            className="grid shrink-0 place-items-center rounded-full"
            title="Queue follow-up for when this answer finishes"
            onClick={() => void onQueueFollowup()}
            disabled={stopping}
          />
        )}
        <IconButton
          icon="stop"
          label="Stop request"
          variant="primary"
          className="grid shrink-0 place-items-center rounded-full"
          title="Stop"
          onClick={() => void stop()}
          disabled={stopping}
        />
      </div>
    );
  }
  return (
    <IconButton
      icon="send"
      label="Send prompt"
      variant="primary"
      className="grid shrink-0 place-items-center rounded-full"
      type="submit"
      title="Send"
      disabled={!canSend}
    />
  );
}

export function ComposerActionRow({
  expanded,
  captureControl,
  modeControl,
  busy,
  stopping,
  canSend,
  canQueue,
  onQueueFollowup,
  stop,
}: {
  expanded: boolean;
  captureControl: ReactNode;
  modeControl: ReactNode;
  busy: boolean;
  stopping: boolean;
  canSend: boolean;
  canQueue?: boolean;
  onQueueFollowup?: () => Promise<void>;
  stop: () => Promise<void>;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-1 ${expanded ? "mt-2 justify-between" : "shrink-0"}`}
    >
      {expanded ? (
        <div className="flex items-center gap-1">
          {captureControl}
          {modeControl}
        </div>
      ) : (
        modeControl
      )}
      <SubmitControl
        busy={busy}
        stopping={stopping}
        canSend={canSend}
        canQueue={canQueue}
        onQueueFollowup={onQueueFollowup}
        stop={stop}
      />
    </div>
  );
}
