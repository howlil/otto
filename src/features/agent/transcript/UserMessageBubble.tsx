import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button, IconButton, Text, TextArea, VisuallyHidden } from "../../../shared/ui";

export function UserMessageBubble({
  messageId,
  text,
  editable,
  editing,
  draft,
  onStartEdit,
  onChangeDraft,
  onCancelEdit,
  onSubmitEdit,
}: {
  messageId: string;
  text: string;
  editable: boolean;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onChangeDraft: (value: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus({ preventScroll: true });
  }, [editing]);

  if (editing) {
    const fieldId = `otto-edit-${messageId}`;
    const canSubmit = draft.trim().length > 0;
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelEdit();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (canSubmit) onSubmitEdit();
      }
    };
    return (
      <div className="ml-auto flex max-w-[92%] flex-col gap-1.5 rounded-[12px] border border-otto-line-focused bg-otto-control px-2.5 py-2">
        <VisuallyHidden htmlFor={fieldId}>Edit prompt</VisuallyHidden>
        <TextArea
          ref={inputRef}
          id={fieldId}
          rows={2}
          value={draft}
          onChange={(event) => onChangeDraft(event.target.value)}
          onKeyDown={onKeyDown}
          className="otto-scrollbar-hidden max-h-[120px] min-h-[38px] w-full resize-none border-0 bg-transparent p-0 text-otto-md leading-[1.45] text-otto-text outline-none shadow-none"
        />
        <div className="flex items-center justify-between gap-2">
          <Text as="span" variant="caption" className="text-otto-text-tertiary">
            Enter to re-run · Esc to cancel
          </Text>
          <div className="flex items-center gap-1">
            <Button variant="quiet" size="xs" onClick={onCancelEdit}>
              Cancel
            </Button>
            <Button variant="primary" size="xs" disabled={!canSubmit} onClick={onSubmitEdit}>
              Re-run
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start justify-end gap-1">
      {editable && (
        <IconButton
          icon="rename"
          size={12}
          label="Edit prompt"
          title="Edit prompt and re-run"
          variant="quiet"
          className="mt-1 h-6 w-6 shrink-0 rounded-full opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={onStartEdit}
        />
      )}
      <div className="max-w-[87%] whitespace-pre-wrap rounded-[12px_12px_4px_12px] bg-otto-raised-soft px-[11px] py-[9px] text-otto-text-soft-white [overflow-wrap:anywhere]">
        <Text as="span" variant="body-compact">
          {text}
        </Text>
      </div>
    </div>
  );
}
