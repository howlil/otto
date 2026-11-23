import { Fragment, useCallback, useEffect, useState } from "react";
import type { AgentSnapshot, LearningMode } from "../../../platform/tauri";
import { captureIsWorking } from "../model/status";
import { formatLatencyMeta } from "../settings/model-picker";
import { ActivityTrail } from "./ActivityTrail";
import { TranscriptMessageRow } from "./TranscriptMessageRow";

export function TranscriptMessages({
  snapshot,
  busy,
  canAct = !busy,
  activity = null,
  onInsert,
  onRetry,
  onEditPrompt,
  onFollowupChip,
}: {
  snapshot: AgentSnapshot;
  busy: boolean;
  canAct?: boolean;
  activity?: string | null;
  onInsert?: (value: string) => Promise<void>;
  onRetry?: () => Promise<void>;
  onEditPrompt?: (messageId: string, text: string) => Promise<void>;
  onFollowupChip?: (mode: LearningMode, prompt: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  useEffect(() => {
    if (busy) setEditingId(null);
  }, [busy]);

  const handleStartEdit = useCallback((messageId: string, messageText: string) => {
    setEditingId(messageId);
    setEditDraft(messageText);
  }, []);
  const handleCancelEdit = useCallback(() => setEditingId(null), []);
  const handleSubmitEdit = useCallback(
    (messageId: string) => {
      const nextText = editDraft.trim();
      if (!nextText) return;
      setEditingId(null);
      void onEditPrompt?.(messageId, nextText);
    },
    [editDraft, onEditPrompt],
  );

  const preTurnCapture =
    captureIsWorking(snapshot.capture.phase) && snapshot.capture.phase !== "analyzing";
  const targetAssistantId =
    snapshot.status !== "idle" && !preTurnCapture ? `${snapshot.runId}:assistant` : null;
  const attachAbove =
    targetAssistantId !== null &&
    snapshot.messages.some((message) => message.id === targetAssistantId);
  const latestLatency =
    snapshot.status === "completed" ? formatLatencyMeta(snapshot.turnTiming, snapshot.runId) : null;

  return (
    <>
      {snapshot.messages.map((message, index) => {
        const isLast = index === snapshot.messages.length - 1;
        const stoppedPartial = isLast && snapshot.status === "stopped";
        const showFollowupChips = isLast && canAct && !busy && snapshot.status === "completed";
        const editing = editingId === message.id;
        return (
          <Fragment key={message.id}>
            {attachAbove && message.id === targetAssistantId && (
              <ActivityTrail snapshot={snapshot} current={activity} />
            )}
            <TranscriptMessageRow
              id={message.id}
              role={message.role}
              text={message.text}
              busy={busy}
              canAct={canAct}
              isLast={isLast}
              stoppedPartial={stoppedPartial}
              showFollowupChips={showFollowupChips}
              latency={isLast ? latestLatency : null}
              editing={editing}
              editDraft={editing ? editDraft : ""}
              hasEditPrompt={Boolean(onEditPrompt)}
              onStartEdit={handleStartEdit}
              onChangeDraft={setEditDraft}
              onCancelEdit={handleCancelEdit}
              onSubmitEdit={handleSubmitEdit}
              onInsert={onInsert}
              onRetry={onRetry}
              onFollowupChip={onFollowupChip}
            />
          </Fragment>
        );
      })}
      {!attachAbove && <ActivityTrail snapshot={snapshot} current={activity} />}
    </>
  );
}
