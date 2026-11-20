import type { RefObject } from "react";
import type { AgentConversationSummary } from "../../../platform/tauri";
import { Text } from "../../../shared/ui";
import { groupConversationsByDate } from "./history-model";
import { HistoryRow } from "./HistoryRow";

export function HistoryRows({
  rows,
  activeConversationId = null,
  exportedId = null,
  now,
  disabled,
  titleDraft,
  renameInput,
  renamingId,
  confirmId,
  onDraft,
  onOpen,
  onExport,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  rows: AgentConversationSummary[];
  activeConversationId?: string | null;
  exportedId?: string | null;
  now: number;
  disabled: boolean;
  titleDraft: string;
  renameInput: RefObject<HTMLInputElement | null>;
  renamingId: string | null;
  confirmId: string | null;
  onDraft: (value: string) => void;
  onOpen: (id: string) => void;
  onExport?: (id: string) => void;
  onStartRename: (conversation: AgentConversationSummary) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onStartDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}) {
  if (rows.length === 0) return null;
  const groups = groupConversationsByDate(rows, now);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label} className="min-w-0">
          <Text
            as="h3"
            variant="caption"
            className="m-0 mb-1.5 px-1 font-medium text-otto-text-tertiary"
          >
            {group.label}
          </Text>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {group.items.map((conversation) => (
              <HistoryRow
                key={conversation.id}
                conversation={conversation}
                isCurrent={activeConversationId === conversation.id}
                exported={exportedId === conversation.id}
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
                onExport={onExport ? () => onExport(conversation.id) : undefined}
                onStartRename={() => onStartRename(conversation)}
                onCommitRename={() => onCommitRename(conversation.id)}
                onCancelRename={onCancelRename}
                onStartDelete={() => onStartDelete(conversation.id)}
                onConfirmDelete={() => onConfirmDelete(conversation.id)}
                onCancelDelete={onCancelDelete}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
