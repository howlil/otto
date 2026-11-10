import { useLayoutEffect, useRef, useState, type FormEvent, type Ref } from "react";
import type { AgentProvider, CapturePhase } from "../../platform/tauri";
import { IconButton, TextArea, VisuallyHidden } from "../../shared/ui";
import { providerLabel } from "./history-model";

const PROMPT_LINE_HEIGHT = 19;
const PROMPT_MAX_HEIGHT = 105;

function usePromptSizing(draft: string) {
  const prompt = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const area = prompt.current;
    if (!area) return;
    area.style.height = "0px";
    const contentHeight = Math.min(
      PROMPT_MAX_HEIGHT,
      Math.max(PROMPT_LINE_HEIGHT, area.scrollHeight),
    );
    area.style.height = `${contentHeight}px`;
    area.style.overflowY = area.scrollHeight > PROMPT_MAX_HEIGHT ? "auto" : "hidden";
    setExpanded(draft.length > 0 && contentHeight > PROMPT_LINE_HEIGHT);
  }, [draft]);

  return { prompt, expanded };
}

function CaptureControl({
  capturePhase,
  busy,
  captureBusy,
  onCapture,
}: {
  capturePhase: CapturePhase;
  busy: boolean;
  captureBusy: boolean;
  onCapture: () => void;
}) {
  const retry = capturePhase === "failed";
  return (
    <IconButton
      id="otto-capture-setup"
      icon="camera"
      label={retry ? "Retry screen capture" : "Capture selected screen source"}
      variant="round"
      className="grid shrink-0 place-items-center rounded-full"
      onClick={onCapture}
      title={retry ? "Retry screen capture" : "Capture using the configured source"}
      disabled={busy || captureBusy}
    />
  );
}

export function AgentComposer({
  provider,
  imageTransport,
  composerRef,
  draft,
  setDraft,
  busy,
  captureBusy,
  capturePhase,
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
  canSend: boolean;
  stopping: boolean;
  onCapture: () => void;
  send: () => Promise<void>;
  stop: () => Promise<void>;
}) {
  const { prompt, expanded } = usePromptSizing(draft);
  const captureControl = imageTransport ? (
    <CaptureControl
      capturePhase={capturePhase}
      busy={busy}
      captureBusy={captureBusy}
      onCapture={onCapture}
    />
  ) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) void send();
  };

  return (
    <div ref={composerRef} className="relative shrink-0 px-3 pb-3 pt-[7px]">
      <form
        className={`flex border border-transparent bg-otto-control-deep transition-[border-color,background] duration-150 hover:bg-otto-control-hover focus-within:border-otto-line-hover ${expanded ? "min-h-[68px] flex-col rounded-[22px] gap-0 px-[10px] pb-[10px] pt-[10px]" : "min-h-[44px] flex-row items-center gap-[5px] rounded-full p-[5px]"}`}
        onSubmit={submit}
      >
        <VisuallyHidden htmlFor="otto-prompt">Question for the selected agent</VisuallyHidden>
        {!expanded && captureControl}
        <TextArea
          ref={prompt}
          id="otto-prompt"
          rows={1}
          placeholder={`Ask ${providerLabel(provider)}…`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={`otto-scrollbar-hidden resize-none border-0 bg-transparent px-1 text-otto-md leading-[1.5] text-otto-text outline-none shadow-none placeholder:text-otto-text-subtle ${expanded ? "block max-h-[105px] min-h-[19px] w-full" : "min-h-[19px] min-w-0 max-h-[19px] flex-1"}`}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) void send();
            }
          }}
        />
        <div
          className={`flex min-w-0 items-center gap-1 ${expanded ? "mt-2 justify-between" : "shrink-0"}`}
        >
          {expanded && captureControl}
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
        </div>
      </form>
    </div>
  );
}
