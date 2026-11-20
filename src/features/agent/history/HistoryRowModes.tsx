import type { RefObject } from "react";
import { Button, Text, TextField } from "../../../shared/ui";
import type { AgentConversationSummary } from "../../../platform/tauri";
import { normalizeTitle } from "./history-model";

export const RENAME_FIELD = "otto-history-rename";

export type HistoryRowModeProps = {
  conversation: AgentConversationSummary;
  disabled: boolean;
  titleDraft: string;
  renameRef: RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

export function HistoryRowRename(props: HistoryRowModeProps) {
  const canSave = normalizeTitle(props.titleDraft) !== null;
  return (
    <li className="rounded-otto-panel border border-otto-line-focused bg-otto-control px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block" htmlFor={RENAME_FIELD}>
          <Text as="span" variant="caption" className="block text-otto-text-secondary">
            Conversation title
          </Text>
        </label>
        <Text as="span" variant="caption" className="text-otto-text-tertiary">
          Enter to save · Esc to cancel
        </Text>
      </div>
      <div className="flex items-center gap-1.5">
        <TextField
          id={RENAME_FIELD}
          ref={props.renameRef}
          value={props.titleDraft}
          onChange={(event) => props.onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.onCommitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              props.onCancelRename();
            }
          }}
          spellCheck={false}
          density="compact"
          className="min-w-0 flex-1"
        />
        <Button
          variant="primary"
          size="xs"
          disabled={props.disabled || !canSave}
          onClick={props.onCommitRename}
        >
          Save
        </Button>
        <Button variant="quiet" size="xs" onClick={props.onCancelRename}>
          Cancel
        </Button>
      </div>
    </li>
  );
}

export function HistoryRowConfirm(props: HistoryRowModeProps) {
  return (
    <li className="rounded-otto-panel border border-otto-danger bg-otto-field-deep px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <Text
          as="p"
          variant="meta"
          className="m-0 min-w-0 flex-1 text-otto-danger-detail [overflow-wrap:anywhere]"
        >
          Delete “{props.conversation.title}”? This cannot be undone.
        </Text>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="secondary"
            size="xs"
            className="border-otto-danger text-otto-danger-copy hover:bg-otto-error-bg"
            disabled={props.disabled}
            onClick={props.onConfirmDelete}
          >
            Delete
          </Button>
          <Button variant="quiet" size="xs" onClick={props.onCancelDelete}>
            Cancel
          </Button>
        </div>
      </div>
    </li>
  );
}
