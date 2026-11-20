import type { RefObject } from "react";
import { IconButton, Text } from "../../../shared/ui";
import type { AgentConversationSummary } from "../../../platform/tauri";
import { conversationDetail, conversationPreview } from "./history-model";
import { HistoryRowConfirm, HistoryRowRename } from "./HistoryRowModes";

export { RENAME_FIELD } from "./HistoryRowModes";
export type RowMode = "row" | "rename" | "confirm";

export type HistoryRowProps = {
  conversation: AgentConversationSummary;
  isCurrent?: boolean;
  exported?: boolean;
  now: number;
  disabled: boolean;
  mode: RowMode;
  titleDraft: string;
  renameRef: RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void;
  onOpen: () => void;
  onExport?: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

export function HistoryRow(props: HistoryRowProps) {
  const { conversation, isCurrent = false, exported = false, mode } = props;
  if (mode === "rename") return <HistoryRowRename {...props} />;
  if (mode === "confirm") return <HistoryRowConfirm {...props} />;
  const preview = conversationPreview(conversation);

  return (
    <li
      className={`group flex items-start gap-1.5 rounded-otto-panel border px-2.5 py-2 transition-colors duration-150 focus-within:border-otto-line-focused ${
        isCurrent
          ? "border-otto-line-focused bg-otto-selected hover:bg-otto-selected-hover"
          : "border-otto-line-soft bg-otto-control hover:border-otto-line-hover hover:bg-otto-control-hover"
      }`}
    >
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onOpen}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left outline-none disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Text as="span" variant="label" className="block min-w-0 truncate text-otto-text-bright">
            {conversation.title}
          </Text>
          {isCurrent && (
            <Text
              as="span"
              variant="caption"
              className="shrink-0 rounded-otto-chip border border-otto-line-mid bg-otto-raised-soft px-1.5 py-0.5 text-otto-text-secondary"
            >
              Current
            </Text>
          )}
        </span>
        {preview && (
          <Text
            as="span"
            variant="caption"
            className="mt-0.5 block truncate text-otto-text-secondary"
          >
            {preview}
          </Text>
        )}
        <Text
          as="span"
          variant="caption"
          className={`mt-1 block truncate tabular-nums ${
            conversation.interrupted ? "text-otto-warn" : "text-otto-text-tertiary"
          }`}
        >
          {conversationDetail(conversation, props.now)}
        </Text>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 pt-0.5 opacity-80 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        {props.onExport && (
          <IconButton
            icon={exported ? "check" : "download"}
            size={14}
            label={`Export ${conversation.title} as Markdown`}
            title={exported ? "Copied Markdown" : "Export Markdown"}
            variant="quiet"
            disabled={props.disabled}
            onClick={props.onExport}
          />
        )}
        <IconButton
          icon="rename"
          size={14}
          label={`Rename ${conversation.title}`}
          title="Rename conversation"
          variant="quiet"
          disabled={props.disabled}
          onClick={props.onStartRename}
        />
        <IconButton
          icon="delete"
          size={14}
          label={`Delete ${conversation.title}`}
          title="Delete conversation"
          variant="quiet"
          disabled={props.disabled}
          onClick={props.onStartDelete}
        />
      </div>
    </li>
  );
}
