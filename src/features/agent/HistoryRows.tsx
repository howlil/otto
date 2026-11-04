import type { RefObject } from "react";
import type { AgentConversationSummary } from "../../platform/tauri";
import { HistoryRow } from "./HistoryRow";

export function HistoryRows({
  rows,
  now,
  disabled,
  titleDraft,
  renameInput,
  renamingId,
  confirmId,
  onDraft,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  rows: AgentConversationSummary[];
  now: number;
  disabled: boolean;
  titleDraft: string;
  renameInput: RefObject<HTMLInputElement | null>;
  renamingId: string | null;
  confirmId: string | null;
  onDraft: (value: string) => void;
  onOpen: (id: string) => void;
  onStartRename: (conversation: AgentConversationSummary) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onStartDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {rows.map((conversation) => (
        <HistoryRow
          key={conversation.id}
          conversation={conversation}
          now={now}
          disabled={disabled}
          titleDraft={titleDraft}
          renameRef={renameInput}
          onDraft={onDraft}
          mode={
            renamingId === conversation.id
              ? "rename"
              : confirmId === conversation.id
                ? "confirm"
                : "row"
          }
          onOpen={() => onOpen(conversation.id)}
          onStartRename={() => onStartRename(conversation)}
          onCommitRename={() => onCommitRename(conversation.id)}
          onCancelRename={onCancelRename}
          onStartDelete={() => onStartDelete(conversation.id)}
          onConfirmDelete={() => onConfirmDelete(conversation.id)}
          onCancelDelete={onCancelDelete}
        />
      ))}
    </ul>
  );
}
