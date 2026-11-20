import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { startNotchDragging } from "../../../platform/tauri/shell";
import type { Placement } from "../model/preferences";

function canDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("[data-otto-drag-surface]")) return true;
  return !target.closest("button, input, textarea, select, a, [contenteditable='true']");
}

export function usePanelDrag({
  surfaceKey,
  expanded,
  pinned,
  pin,
}: {
  surfaceKey: Placement;
  expanded: boolean;
  pinned: boolean;
  pin: () => void;
}) {
  const candidate = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRelease = useCallback((delay: number) => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      dragging.current = false;
      releaseTimer.current = null;
    }, delay);
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (
        surfaceKey !== "floating" ||
        event.button !== 0 ||
        event.defaultPrevented ||
        !canDragTarget(event.target)
      ) {
        return;
      }
      dragging.current = false;
      if (expanded && !pinned) pin();
      candidate.current = { x: event.clientX, y: event.clientY };
    },
    [expanded, pin, pinned, surfaceKey],
  );
  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const origin = candidate.current;
      if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4) return;
      candidate.current = null;
      dragging.current = true;
      scheduleRelease(2000);
      void startNotchDragging().catch(() => {
        dragging.current = false;
      });
    },
    [scheduleRelease],
  );
  const handlePointerUp = useCallback(() => {
    candidate.current = null;
    if (dragging.current) scheduleRelease(100);
  }, [scheduleRelease]);
  const noteMoved = useCallback(() => {
    if (dragging.current) scheduleRelease(2000);
  }, [scheduleRelease]);
  const isDragging = useCallback(() => dragging.current, []);

  useEffect(() => {
    const release = () => {
      candidate.current = null;
      if (dragging.current) scheduleRelease(100);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    };
  }, [scheduleRelease]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    noteMoved,
    isDragging,
  };
}
