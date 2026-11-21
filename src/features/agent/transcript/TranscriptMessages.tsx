import { Fragment, useEffect, useState } from "react";
import type { AgentSnapshot, LearningMode } from "../../../platform/tauri";
import { captureIsWorking } from "../model/status";
import { formatLatencyMeta } from "../settings/model-picker";
import { ActivityTrail } from "./ActivityTrail";
import { DeferredMessageContent } from "./content/DeferredMessageContent";
import { AssistantTurnActions, UserMessageBubble } from "./TurnActions";

export function TranscriptMessages({
  snapshot,
  busy,
  canAct = !busy,
  activity = null,
  speakingMessageId = null,
  onToggleSpeak,
  onInsert,
  onRetry,
  onEditPrompt,
  onFollowupChip,
}: {
  snapshot: AgentSnapshot;
  busy: boolean;
  canAct?: boolean;
  activity?: string | null;
  speakingMessageId?: string | null;
  onToggleSpeak?: (messageId: string, text: string) => void;
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
        return (
          <Fragment key={message.id}>
            {attachAbove && message.id === targetAssistantId && (
              <ActivityTrail snapshot={snapshot} current={activity} />
            )}
            <div className="min-w-0">
              {message.role === "user" ? (
                <UserMessageBubble
                  messageId={message.id}
                  text={message.text}
                  editable={canAct && !busy && Boolean(onEditPrompt)}
                  editing={editingId === message.id}
                  draft={editDraft}
                  onStartEdit={() => {
                    setEditingId(message.id);
                    setEditDraft(message.text);
                  }}
                  onChangeDraft={setEditDraft}
                  onCancelEdit={() => setEditingId(null)}
                  onSubmitEdit={() => {
                    const nextText = editDraft.trim();
                    if (!nextText) return;
                    setEditingId(null);
                    void onEditPrompt?.(message.id, nextText);
                  }}
                />
              ) : (
                <div className="min-w-0 w-full break-words text-otto-text-soft-white">
                  <DeferredMessageContent text={message.text} />
                  {!busy && message.text.trim() && (
                    <AssistantTurnActions
                      messageId={message.id}
                      text={message.text}
                      isLatest={isLast}
                      stoppedPartial={stoppedPartial}
                      canAct={canAct}
                      showFollowupChips={showFollowupChips}
                      latency={isLast ? latestLatency : null}
                      speaking={speakingMessageId === message.id}
                      onToggleSpeak={onToggleSpeak}
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
          </Fragment>
        );
      })}
      {!attachAbove && <ActivityTrail snapshot={snapshot} current={activity} />}
    </>
  );
}
