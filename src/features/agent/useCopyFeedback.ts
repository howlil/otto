import { useCallback, useEffect, useRef, useState } from "react";

export type CopyFeedbackState = "idle" | "copied" | "error";

async function writeClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}

  const active = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : [];
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(area);
  let copied = false;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } finally {
    area.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
  if (!copied) throw new Error("Clipboard unavailable");
}

export function useCopyFeedback(duration = 1900) {
  const [state, setState] = useState<CopyFeedbackState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAttempt = useRef(0);

  useEffect(
    () => () => {
      currentAttempt.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (value: string) => {
      const attempt = ++currentAttempt.current;
      if (timer.current) clearTimeout(timer.current);
      try {
        await writeClipboard(value);
        if (attempt !== currentAttempt.current) return;
        setState("copied");
      } catch {
        if (attempt !== currentAttempt.current) return;
        setState("error");
      }
      timer.current = setTimeout(() => {
        if (attempt === currentAttempt.current) setState("idle");
      }, duration);
    },
    [duration],
  );

  return { state, copy };
}
