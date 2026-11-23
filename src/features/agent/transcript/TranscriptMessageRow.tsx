import { memo } from "react";
import type { LearningMode } from "../../../platform/tauri";
import type { LatencyDisplay } from "../settings/model-picker";
import { DeferredMessageContent } from "./content/DeferredMessageContent";
import { AssistantTurnActions, UserMessageBubble } from "./TurnActions";

export const TranscriptMessageRow = memo(function TranscriptMessageRow({
  id,
  role,
  text,
  busy,
  canAct,
  isLast,
  stoppedPartial,
  showFollowupChips,
  latency,
  editing,
  editDraft,
  hasEditPrompt,
  onStartEdit,
  onChangeDraft,
  onCancelEdit,
  onSubmitEdit,
  onInsert,
  onRetry,
  onFollowupChip,
}: {
  id: string;
  role: "user" | "assistant";
  text: string;
  busy: boolean;
  canAct: boolean;
  isLast: boolean;
  stoppedPartial: boolean;
  showFollowupChips: boolean;
  latency: LatencyDisplay | null;
  editing: boolean;
  editDraft: string;
  hasEditPrompt: boolean;
  onStartEdit: (messageId: string, messageText: string) => void;
  onChangeDraft: (value: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (messageId: string) => void;
  onInsert?: (value: string) => Promise<void>;
  onRetry?: () => Promise<void>;
  onFollowupChip?: (mode: LearningMode, prompt: string) => Promise<void>;
}) {
  return (
    <div className="min-w-0">
      {role === "user" ? (
        <UserMessageBubble
          messageId={id}
          text={text}
          editable={canAct && !busy && hasEditPrompt}
          editing={editing}
          draft={editDraft}
          onStartEdit={() => onStartEdit(id, text)}
          onChangeDraft={onChangeDraft}
          onCancelEdit={onCancelEdit}
          onSubmitEdit={() => onSubmitEdit(id)}
        />
      ) : (
        <div className="min-w-0 w-full break-words text-otto-text-soft-white">
          <DeferredMessageContent text={text} />
          {!busy && text.trim() && (
            <AssistantTurnActions
              text={text}
              isLatest={isLast}
              stoppedPartial={stoppedPartial}
              canAct={canAct}
              showFollowupChips={showFollowupChips}
              latency={latency}
              onInsert={onInsert}
              onRetry={onRetry}
              onFollowupChip={onFollowupChip}
            />
          )}
          {busy && isLast && (
            <span className="ml-0.5 inline-block h-3 w-1 bg-otto-control-text motion-safe:animate-otto-caret motion-reduce:animate-none" />
          )}
        </div>
      )}
    </div>
  );
});
