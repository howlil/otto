import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { AgentProvider } from "../../platform/tauri";
import { IconButton, TextArea, VisuallyHidden } from "../../shared/ui";

export function AgentComposer({
  provider,
  imageTransport,
  draft,
  setDraft,
  busy,
  approvalPending,
  canSend,
  stopping,
  onCapture,
  send,
  stop,
}: {
  provider: AgentProvider;
  imageTransport: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  busy: boolean;
  approvalPending: boolean;
  canSend: boolean;
  stopping: boolean;
  onCapture: () => void;
  send: () => Promise<void>;
  stop: () => Promise<void>;
}) {
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const runtimeButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const area = prompt.current;
    if (!area) return;
    if (!draft) {
      area.style.height = "19px";
      area.style.overflowY = "hidden";
      return;
    }
    area.style.height = "0px";
    area.style.height = `${Math.min(105, Math.max(19, area.scrollHeight))}px`;
    area.style.overflowY = area.scrollHeight > 105 ? "auto" : "hidden";
  }, [draft]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) void send();
  };

  return (
    <div className="relative shrink-0 px-3 pb-3 pt-[7px]">
      {runtimeOpen && (
        <section
          className="absolute bottom-[calc(100%+2px)] left-3 right-3 z-20 max-h-[240px] overflow-y-auto rounded-[15px] border border-otto-line-hover bg-otto-control-deep p-3 text-otto-text [scrollbar-width:none]"
          aria-labelledby="otto-model-context-heading"
        >
          <div className="flex items-center justify-between gap-2">
            <strong id="otto-model-context-heading" className="text-otto-md">Model &amp; context</strong>
            <button
              type="button"
              className="rounded-otto-control px-2 py-1 text-otto-xs text-otto-text-secondary hover:bg-otto-control-hover"
              onClick={() => {
                setRuntimeOpen(false);
                runtimeButton.current?.focus();
              }}
            >
              Close
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-otto-xs">
            <dt className="text-otto-text-tertiary">Active model</dt>
            <dd>Not detected</dd>
            <dt className="text-otto-text-tertiary">Thinking effort</dt>
            <dd>Unavailable</dd>
            <dt className="text-otto-text-tertiary">Context used</dt>
            <dd>Unavailable</dd>
            <dt className="text-otto-text-tertiary">Context remaining</dt>
            <dd>Unavailable</dd>
          </dl>
          <p className="mt-3 text-otto-xs leading-[1.5] text-otto-text-tertiary">
            Otto cannot read model, thinking effort or context usage from the current native
            snapshot. Context remaining is not an account token quota.
          </p>
        </section>
      )}
      <form
        className="flex min-h-[68px] flex-col rounded-[22px] border border-transparent bg-otto-control-deep px-[10px] pb-[7px] pt-[10px] transition-[border-color,background] duration-150 hover:bg-otto-control-hover focus-within:border-otto-line-hover"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && runtimeOpen) {
            event.stopPropagation();
            setRuntimeOpen(false);
            runtimeButton.current?.focus();
          }
        }}
      >
        <VisuallyHidden htmlFor="otto-prompt">Question for the selected agent</VisuallyHidden>
        <TextArea
          ref={prompt}
          id="otto-prompt"
          rows={1}
          placeholder={`Ask ${provider === "pi" ? "Pi" : provider === "agy" ? "Agy" : "Codex"}…`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="block max-h-[105px] min-h-[19px] w-full resize-none overflow-y-hidden border-0 bg-transparent px-1 text-otto-md leading-[1.5] text-otto-text outline-none shadow-none placeholder:text-otto-text-subtle [scrollbar-width:none]"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) void send();
            }
          }}
        />
        <div className="mt-2 flex min-w-0 items-center gap-1">
          {imageTransport && (
            <IconButton
              id="otto-capture-setup"
              icon="camera"
              label="Capture selected screen source"
              variant="round"
              className="grid shrink-0 place-items-center rounded-full"
              onClick={onCapture}
              title="Capture using the configured source"
              disabled={busy || approvalPending}
            />
          )}
          <button
            ref={runtimeButton}
            type="button"
            aria-expanded={runtimeOpen}
            className="min-w-0 rounded-otto-control px-1.5 py-1 text-otto-xs text-otto-text-tertiary hover:bg-otto-selected-hover hover:text-otto-text"
            onClick={() => setRuntimeOpen((open) => !open)}
          >
            Model — · Think — · Context —
          </button>
          <span className="min-w-0 flex-1" />
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
              disabled={!canSend || approvalPending}
            />
          )}
        </div>
      </form>
    </div>
  );
}
