import { useEffect, useRef, useState } from "react";
import type { LearningMode } from "../../../platform/tauri";
import { Icon, Text, VisuallyHidden } from "../../../shared/ui";
import {
  LEARNING_MODES,
  learningModeOption,
  type LearningModeOption,
} from "../model/learning-mode";

export function LearningModePicker({
  mode,
  disabled,
  align = "right",
  onSelect,
}: {
  mode: LearningMode;
  disabled: boolean;
  align?: "left" | "right";
  onSelect: (mode: LearningMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = learningModeOption(mode);

  const closeAndRestore = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

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
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Learning mode: ${active.label} (${active.slash})`}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-otto-xs transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-otto-line-focused disabled:opacity-50 ${
          mode === "direct"
            ? "border-transparent bg-otto-control text-otto-text-secondary hover:bg-otto-control-hover hover:text-otto-text-bright"
            : "border-otto-line-strong bg-otto-selected text-otto-text-bright hover:bg-otto-selected-hover"
        }`}
      >
        <VisuallyHidden>Learning mode: </VisuallyHidden>
        <span>{active.shortLabel}</span>
        <Icon name="chevronDown" size={11} className="text-otto-text-tertiary" />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute bottom-full z-30 mb-2 w-[236px] rounded-otto-card border border-otto-line-strong bg-otto-surface p-1.5 shadow-lg ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          {LEARNING_MODES.map((option) => {
            const selected = option.id === mode;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onSelect(option.id);
                  closeAndRestore();
                }}
                className={`flex w-full items-start justify-between gap-2 rounded-otto-chip border-0 px-2 py-1.5 text-left transition-colors duration-150 ${
                  selected
                    ? "bg-otto-selected text-otto-text-bright"
                    : "bg-transparent text-otto-text-secondary hover:bg-otto-control"
                }`}
              >
                <span className="min-w-0">
                  <Text as="span" variant="status" className="block text-otto-text-bright">
                    {option.label}
                  </Text>
                  <Text as="span" variant="caption" className="block text-otto-text-tertiary">
                    {option.description}
                  </Text>
                </span>
                <Text as="span" variant="meta" className="shrink-0 font-mono text-otto-text-subtle">
                  {option.slash}
                </Text>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SlashModeMenu({
  options,
  highlightedIndex,
  onPick,
}: {
  options: LearningModeOption[];
  highlightedIndex: number;
  onPick: (option: LearningModeOption) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-labelledby="otto-slash-modes-heading"
      className="absolute inset-x-3 bottom-full z-30 mb-1.5 rounded-otto-card border border-otto-line-strong bg-otto-surface p-1.5 shadow-lg"
    >
      <span id="otto-slash-modes-heading" className="sr-only">
        Learning mode slash commands
      </span>
      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          role="option"
          aria-selected={index === highlightedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(option)}
          className={`flex w-full items-center justify-between gap-2 rounded-otto-chip border-0 px-2.5 py-1.5 text-left transition-colors duration-150 ${
            index === highlightedIndex
              ? "bg-otto-selected text-otto-text-bright"
              : "bg-transparent text-otto-text-secondary hover:bg-otto-control"
          }`}
        >
          <span className="min-w-0 truncate">
            <Text as="span" variant="status" className="text-otto-text-bright">
              {option.label}
            </Text>
            <Text as="span" variant="caption" className="ml-2 text-otto-text-tertiary">
              {option.description}
            </Text>
          </span>
          <Text as="span" variant="meta" className="shrink-0 font-mono text-otto-text-subtle">
            {option.slash}
          </Text>
        </button>
      ))}
    </div>
  );
}
