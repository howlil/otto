import { useLayoutEffect, useRef, type FormEvent, type Ref } from "react";
import type { AgentProvider, CapturePhase } from "../../platform/tauri";
import { IconButton, TextArea, VisuallyHidden } from "../../shared/ui";

export function AgentComposer({
  provider,
  imageTransport,
  composerRef,
  draft,
  setDraft,
  busy,
  captureBusy,
  capturePhase,
  approvalPending,
  canSend,
  stopping,
  onCapture,
  send,
  stop,
}: {
  provider: AgentProvider;
  imageTransport: boolean;
  composerRef: Ref<HTMLDivElement>;
  draft: string;
  setDraft: (draft: string) => void;
  busy: boolean;
  captureBusy: boolean;
  capturePhase: CapturePhase;
  approvalPending: boolean;
  canSend: boolean;
  stopping: boolean;
  onCapture: () => void;
  send: () => Promise<void>;
  stop: () => Promise<void>;
}) {
  const prompt = useRef<HTMLTextAreaElement>(null);

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
    <div ref={composerRef} className="relative shrink-0 px-3 pb-3 pt-[7px]">
      <form
        className="flex min-h-[68px] flex-col rounded-[22px] border border-transparent bg-otto-control-deep px-[10px] pb-[7px] pt-[10px] transition-[border-color,background] duration-150 hover:bg-otto-control-hover focus-within:border-otto-line-hover"
        onSubmit={submit}
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
              label={
                capturePhase === "failed"
                  ? "Retry screen capture"
                  : "Capture selected screen source"
              }
              variant="round"
              className="grid shrink-0 place-items-center rounded-full"
              onClick={onCapture}
              title={
                capturePhase === "failed"
                  ? "Retry screen capture"
                  : "Capture using the configured source"
              }
              disabled={busy || captureBusy || approvalPending}
            />
          )}
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
