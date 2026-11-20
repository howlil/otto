import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { LearningMode } from "../../../platform/tauri";
import { extractClipboardImage } from "../capture/quick-actions";
import {
  matchingSlashModes,
  parseSlashMode,
  type LearningModeOption,
} from "../model/learning-mode";

const PROMPT_LINE_HEIGHT = 19;
const PROMPT_MAX_HEIGHT = 105;

function useAutoResizePrompt(promptRef: { current: HTMLTextAreaElement | null }, draft: string) {
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const area = promptRef.current;
    if (!area) return;
    area.style.height = "0px";
    const contentHeight = Math.min(
      PROMPT_MAX_HEIGHT,
      Math.max(PROMPT_LINE_HEIGHT, area.scrollHeight),
    );
    area.style.height = `${contentHeight}px`;
    area.style.overflowY = area.scrollHeight > PROMPT_MAX_HEIGHT ? "auto" : "hidden";
    setExpanded(draft.length > 0 && contentHeight > PROMPT_LINE_HEIGHT);
  }, [draft, promptRef]);

  return expanded;
}

export function useSlashModeController({
  draft,
  busy,
  canSend,
  canQueue = false,
  setDraft,
  onModeChange,
  send,
  queueFollowup,
}: {
  draft: string;
  busy: boolean;
  canSend: boolean;
  canQueue?: boolean;
  setDraft: (draft: string) => void;
  onModeChange?: (mode: LearningMode) => void;
  send: () => Promise<void>;
  queueFollowup?: () => Promise<void>;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const expanded = useAutoResizePrompt(promptRef, draft);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const slashOptions: LearningModeOption[] = onModeChange && !busy ? matchingSlashModes(draft) : [];
  const slashOpen = slashOptions.length > 0 && dismissedFor !== draft;
  const activeIndex = slashOpen ? slashIndex % slashOptions.length : 0;

  const pickMode = useCallback(
    (next: LearningMode) => {
      onModeChange?.(next);
      setDraft("");
      setSlashIndex(0);
      setDismissedFor(null);
      promptRef.current?.focus({ preventScroll: true });
    },
    [onModeChange, setDraft],
  );

  const trySubmit = useCallback(() => {
    if (busy) {
      if (canQueue && queueFollowup) void queueFollowup();
      return;
    }
    const parsed = onModeChange ? parseSlashMode(draft) : null;
    if (parsed && !parsed.remainder) {
      pickMode(parsed.mode);
      return;
    }
    if (canSend) void send();
  }, [busy, canQueue, canSend, draft, onModeChange, pickMode, queueFollowup, send]);

  const handleSlashKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashIndex((current) => (current + 1) % slashOptions.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashIndex((current) => (current - 1 + slashOptions.length) % slashOptions.length);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedFor(draft);
      return true;
    }
    if (
      (event.key === "Enter" || event.key === "Tab") &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      pickMode(slashOptions[activeIndex].id);
      return true;
    }
    return false;
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && handleSlashKey(event)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      trySubmit();
    }
  };

  return {
    promptRef,
    expanded,
    slashOptions,
    slashOpen,
    activeIndex,
    pickMode,
    trySubmit,
    onPromptKeyDown,
    resetIndex: () => setSlashIndex(0),
  };
}

export function useComposerImageInput(
  onStageImage: ((file: File) => void) | undefined,
  disabled: boolean,
) {
  const onPaste = (event: ClipboardEvent) => {
    if (!onStageImage || disabled) return;
    const file = extractClipboardImage(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    onStageImage(file);
  };

  const onDragOver = (event: DragEvent) => {
    if (onStageImage && !disabled && event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
    }
  };

  const onDrop = (event: DragEvent) => {
    if (!onStageImage || disabled) return;
    const file = extractClipboardImage(event.dataTransfer);
    if (!file) return;
    event.preventDefault();
    onStageImage(file);
  };

  return { onPaste, onDragOver, onDrop };
}
