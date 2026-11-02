import type { RefObject } from "react";
import { Button, IconButton, Text } from "../../shared/ui";
import type { AgentConversationSummary } from "../../platform/tauri";
import { conversationDetail } from "./history-model";

export type RowMode = "row" | "rename" | "confirm";

export const RENAME_FIELD = "otto-history-rename";

export type HistoryRowProps = {
  conversation: AgentConversationSummary;
  now: number;
  disabled: boolean;
  mode: RowMode;
  titleDraft: string;
  renameRef: RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void;
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

export function HistoryRow(props: HistoryRowProps) {
  const { conversation, mode } = props;
  if (mode === "rename") {
    return (
      <li className="rounded-otto-control border border-otto-line-focused bg-otto-control p-2">
        <label className="block" htmlFor={RENAME_FIELD}>
          <Text as="span" variant="caption" className="mb-1 block text-otto-muted">
            Conversation title
          </Text>
        </label>
        <input
          id={RENAME_FIELD}
          ref={props.renameRef}
          value={props.titleDraft}
          onChange={(event) => props.onDraft(event.target.value)}
          onBlur={props.onCommitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.onCommitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              props.onCancelRename();
            }
          }}
          spellCheck={false}
          className="h-[29px] w-full rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2 text-otto-sm text-otto-knob outline-none"
        />
      </li>
    );
  }
  if (mode === "confirm") {
    return (
      <li className="rounded-otto-control border border-otto-danger bg-otto-field-deep p-2">
        <Text
          as="p"
          variant="meta"
          className="m-0 mb-1.5 text-otto-danger-detail [overflow-wrap:anywhere]"
        >
          Delete “{conversation.title}”? This cannot be undone.
        </Text>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="xs" onClick={props.onConfirmDelete}>
            Delete
          </Button>
          <Button variant="quiet" size="xs" onClick={props.onCancelDelete}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-1 rounded-otto-control border border-otto-line bg-otto-control p-2">
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onOpen}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left disabled:opacity-50"
      >
        <Text as="span" variant="label" className="block truncate">
          {conversation.title}
        </Text>
        <Text
          as="span"
          variant="caption"
          className={`mt-1 block truncate ${conversation.interrupted ? "text-otto-warn" : "text-otto-text-tertiary"}`}
        >
          {conversationDetail(conversation, props.now)}
        </Text>
      </button>
      <IconButton
        icon="rename"
        label={`Rename ${conversation.title}`}
        variant="quiet"
        disabled={props.disabled}
        onClick={props.onStartRename}
      />
      <IconButton
        icon="delete"
        label={`Delete ${conversation.title}`}
        variant="quiet"
        disabled={props.disabled}
        onClick={props.onStartDelete}
      />
    </li>
  );
}
