import type { FormEvent } from "react";
import type { AgentProvider } from "../../platform/tauri";
import { IconButton, TextArea, VisuallyHidden } from "../../shared/ui";

export function AgentComposer({
  provider,
  draft,
  setDraft,
  busy,
  approvalPending,
  canSend,
  stopping,
  onConfigureCapture,
  send,
  stop,
}: {
  provider: AgentProvider;
  draft: string;
  setDraft: (draft: string) => void;
  busy: boolean;
  approvalPending: boolean;
  canSend: boolean;
  stopping: boolean;
  onConfigureCapture: () => void;
  send: () => Promise<void>;
  stop: () => Promise<void>;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) void send();
  };

  return (
    <div className="shrink-0 px-3 pb-3 pt-[7px]">
      <form
        className="flex min-h-[50px] items-center gap-[5px] rounded-full border border-transparent bg-otto-control-deep px-[7px] py-[5px] transition-[border-color,background] duration-150 hover:bg-otto-control-deep focus-within:border-otto-line-hover focus-within:outline focus-within:outline-2 focus-within:outline-otto-focus focus-within:outline-offset-2"
        onSubmit={submit}
      >
        {provider !== "agy" && (
          <IconButton
            id="otto-capture-setup"
            icon="camera"
            label="Configure screen capture shortcut"
            variant="round"
            className="grid shrink-0 place-items-center rounded-full"
            onClick={onConfigureCapture}
            title="Configure screen capture shortcut"
          />
        )}
        <VisuallyHidden htmlFor="otto-prompt">Question for the selected agent</VisuallyHidden>
        <TextArea
          id="otto-prompt"
          rows={1}
          placeholder={`Ask ${provider === "pi" ? "Pi" : provider === "agy" ? "Agy" : "Codex"}…`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[22px] min-w-0 max-h-[38px] w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-[3px] text-otto-md leading-[1.45] text-otto-text outline-none shadow-none placeholder:text-otto-text-subtle"
          disabled={busy || approvalPending}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) void send();
            }
          }}
        />
        {busy ? (
          <IconButton
            icon="stop"
            label="Stop request"
            variant="primary"
            className="grid shrink-0 place-items-center rounded-full"
            title="Stop"
            onClick={() => void stop()}
            disabled={stopping}
          />
        ) : (
          <IconButton
            icon="send"
            label="Send prompt"
            variant="primary"
            className="grid shrink-0 place-items-center rounded-full"
            type="submit"
            title="Send"
            disabled={!canSend}
          />
        )}
      </form>
    </div>
  );
}
