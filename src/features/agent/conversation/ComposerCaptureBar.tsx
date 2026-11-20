import { useEffect, useRef, useState } from "react";
import type {
  CapturePhase,
  CaptureSource,
  LearningMode,
  StagedCapture,
} from "../../../platform/tauri";
import { Icon, IconButton, Text, VisuallyHidden } from "../../../shared/ui";
import {
  VISUAL_CAPTURE_SOURCES,
  quickActionsForCapture,
  type CaptureQuickAction,
} from "../capture/quick-actions";

export function StagedCaptureBar({
  staged,
  disabled,
  onClear,
  onQuickAction,
}: {
  staged: StagedCapture;
  disabled: boolean;
  onClear: () => void;
  onQuickAction: (action: CaptureQuickAction) => void;
}) {
  const actions = quickActionsForCapture(staged.kind);
  return (
    <div
      data-staged-capture={staged.kind}
      className="mb-2 flex flex-col gap-1.5 rounded-otto-panel border border-otto-line-soft bg-otto-control/75 px-2.5 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-otto-chip bg-otto-raised-soft text-otto-text-bright">
            <Icon name={staged.kind === "image" ? "camera" : "terminal"} size={13} />
          </span>
          <div className="min-w-0">
            <Text as="span" variant="status" className="block truncate text-otto-text-bright">
              {staged.label}
            </Text>
            <Text as="span" variant="caption" className="block truncate text-otto-text-tertiary">
              {staged.preview}
            </Text>
          </div>
        </div>
        <IconButton
          icon="close"
          label="Remove staged capture"
          variant="quiet"
          className="h-6 w-6 shrink-0 rounded-full"
          disabled={disabled}
          onClick={onClear}
        />
      </div>
      <div data-quick-actions={staged.kind} className="flex flex-wrap gap-1">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={disabled}
            onClick={() => onQuickAction(action)}
            className="rounded-full border border-otto-line bg-otto-surface/80 px-2.5 py-0.5 text-otto-xs text-otto-text-secondary transition-colors duration-150 hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text-bright focus-visible:outline-1 focus-visible:outline-otto-line-focused disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ComposerCameraControl({
  capturePhase,
  captureSource,
  busy,
  captureBusy,
  onCapture,
  onCaptureSource,
}: {
  capturePhase: CapturePhase;
  captureSource: CaptureSource;
  busy: boolean;
  captureBusy: boolean;
  onCapture: () => void;
  onCaptureSource?: (source: Exclude<CaptureSource, "selectedText">) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const retry = capturePhase === "failed";
  const disabled = busy || captureBusy;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0 items-center">
      <IconButton
        id="otto-capture-setup"
        icon="camera"
        label={retry ? "Retry screen capture" : "Capture selected screen source"}
        variant="round"
        className="grid shrink-0 place-items-center rounded-full"
        onClick={onCapture}
        title={retry ? "Retry screen capture" : "Capture using the configured source"}
        disabled={disabled}
      />
      {onCaptureSource && (
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="menu"
          title="Choose visual capture source"
          onClick={() => setOpen((current) => !current)}
          className="ml-0.5 inline-flex h-6 w-5 items-center justify-center rounded-full border-0 bg-transparent text-otto-text-tertiary transition-colors duration-150 hover:bg-otto-control hover:text-otto-text-bright focus-visible:outline-1 focus-visible:outline-otto-line-focused disabled:opacity-50"
        >
          <VisuallyHidden>Choose visual capture source</VisuallyHidden>
          <Icon name="chevronDown" size={11} />
        </button>
      )}
      {open && onCaptureSource && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-2 w-[224px] rounded-otto-card border border-otto-line-strong bg-otto-surface p-1.5 shadow-lg"
        >
          {VISUAL_CAPTURE_SOURCES.map((option) => {
            const active = captureSource === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus({ preventScroll: true });
                  onCaptureSource(option.id);
                }}
                className={`flex w-full flex-col items-start rounded-otto-chip border-0 px-2.5 py-1.5 text-left transition-colors duration-150 ${
                  active
                    ? "bg-otto-selected text-otto-text-bright"
                    : "bg-transparent text-otto-text-secondary hover:bg-otto-control"
                }`}
              >
                <Text as="span" variant="status" className="text-otto-text-bright">
                  {option.label}
                </Text>
                <Text as="span" variant="caption" className="text-otto-text-tertiary">
                  {option.description}
                </Text>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type QuickActionHandler = (mode: LearningMode, prompt: string) => void;
