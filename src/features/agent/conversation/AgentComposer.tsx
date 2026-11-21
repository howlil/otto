import type { FormEvent, ReactNode, Ref } from "react";
import type {
  AgentProvider,
  CapturePhase,
  CaptureSource,
  LearningMode,
  StagedCapture,
} from "../../../platform/tauri";
import { TextArea, VisuallyHidden } from "../../../shared/ui";
import { ComposerActionRow } from "./ComposerActions";
import { ComposerAttachments, composerPlaceholder } from "./ComposerAttachments";
import { ComposerCameraControl } from "./ComposerCaptureBar";
import { LearningModePicker, SlashModeMenu } from "./LearningModeMenu";
import { useComposerImageInput, useSlashModeController } from "./useSlashModeController";

type AgentComposerProps = {
  provider: AgentProvider;
  imageTransport: boolean;
  captureSource: CaptureSource;
  composerRef: Ref<HTMLDivElement>;
  draft: string;
  setDraft: (draft: string) => void;
  mode?: LearningMode;
  onModeChange?: (mode: LearningMode) => void;
  stagedCapture?: StagedCapture | null;
  onClearStagedCapture?: () => void;
  onQuickAction?: (mode: LearningMode, prompt: string) => void;
  onStageImage?: (file: File) => void;
  onCaptureSource?: (source: Exclude<CaptureSource, "selectedText">) => void;
  queuedFollowup?: string | null;
  canQueue?: boolean;
  onQueueFollowup?: () => Promise<void>;
  onClearQueuedFollowup?: () => Promise<void>;
  busy: boolean;
  captureBusy: boolean;
  capturePhase: CapturePhase;
  canSend: boolean;
  stopping: boolean;
  voiceControl?: ReactNode;
  onCapture: () => void;
  send: () => Promise<void>;
  stop: () => Promise<void>;
};

function renderCaptureControl(props: AgentComposerProps) {
  if (!props.imageTransport || props.captureSource === "selectedText") return null;
  return (
    <ComposerCameraControl
      capturePhase={props.capturePhase}
      captureSource={props.captureSource}
      busy={props.busy}
      captureBusy={props.captureBusy}
      onCapture={props.onCapture}
      onCaptureSource={props.onCaptureSource}
    />
  );
}

function renderModeControl(props: AgentComposerProps, disabled: boolean, expanded: boolean) {
  if (!props.onModeChange) return null;
  return (
    <LearningModePicker
      mode={props.mode ?? "direct"}
      disabled={disabled}
      align={expanded ? "left" : "right"}
      onSelect={props.onModeChange}
    />
  );
}

export function AgentComposer(props: AgentComposerProps) {
  const stagedCapture = props.stagedCapture ?? null;
  const queuedFollowup = props.queuedFollowup ?? null;
  const slash = useSlashModeController({
    draft: props.draft,
    busy: props.busy,
    canSend: props.canSend,
    canQueue: props.canQueue ?? false,
    setDraft: props.setDraft,
    onModeChange: props.onModeChange,
    send: props.send,
    queueFollowup: props.onQueueFollowup,
  });
  const expanded = slash.expanded || Boolean(stagedCapture) || Boolean(queuedFollowup);
  const disabled = props.busy || props.captureBusy;
  const imageInput = useComposerImageInput(props.onStageImage, disabled);
  const captureControl = renderCaptureControl(props);
  const modeControl = renderModeControl(props, disabled, expanded);
  const formShape = expanded
    ? "min-h-[68px] flex-col gap-0 rounded-[22px] px-[10px] pb-[10px] pt-[10px]"
    : "min-h-[44px] flex-row items-center gap-[5px] rounded-full p-[5px]";
  const inputShape = expanded
    ? "block max-h-[105px] min-h-[19px] w-full"
    : "min-h-[19px] min-w-0 max-h-[19px] flex-1";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    slash.trySubmit();
  };

  return (
    <div ref={props.composerRef} className="relative shrink-0 px-3 pb-3 pt-[7px]">
      {slash.slashOpen && (
        <SlashModeMenu
          options={slash.slashOptions}
          highlightedIndex={slash.activeIndex}
          onPick={(option) => slash.pickMode(option.id)}
        />
      )}
      <form
        className={`flex border border-transparent bg-otto-control-deep transition-[border-color,background] duration-150 hover:bg-otto-control-hover focus-within:border-otto-line-hover ${formShape}`}
        onSubmit={submit}
        onPaste={imageInput.onPaste}
        onDragOver={imageInput.onDragOver}
        onDrop={imageInput.onDrop}
      >
        <ComposerAttachments
          queuedFollowup={queuedFollowup}
          stagedCapture={stagedCapture}
          stopping={props.stopping}
          disabled={disabled}
          onClearQueuedFollowup={props.onClearQueuedFollowup}
          onClearStagedCapture={props.onClearStagedCapture}
          onQuickAction={props.onQuickAction}
        />
        <VisuallyHidden htmlFor="otto-prompt">Question for the selected agent</VisuallyHidden>
        {!expanded && captureControl}
        <TextArea
          ref={slash.promptRef}
          id="otto-prompt"
          rows={1}
          placeholder={composerPlaceholder(
            stagedCapture,
            props.busy,
            queuedFollowup,
            Boolean(props.onQueueFollowup),
          )}
          value={props.draft}
          onChange={(event) => {
            props.setDraft(event.target.value);
            slash.resetIndex();
          }}
          className={`otto-scrollbar-hidden resize-none border-0 bg-transparent px-1 text-otto-md leading-[1.5] text-otto-text outline-none shadow-none placeholder:text-otto-text-subtle ${inputShape}`}
          onKeyDown={slash.onPromptKeyDown}
        />
        <ComposerActionRow
          expanded={expanded}
          captureControl={captureControl}
          modeControl={modeControl}
          voiceControl={props.voiceControl}
          busy={props.busy}
          stopping={props.stopping}
          canSend={props.canSend}
          canQueue={props.canQueue ?? false}
          onQueueFollowup={props.onQueueFollowup}
          stop={props.stop}
        />
      </form>
    </div>
  );
}
