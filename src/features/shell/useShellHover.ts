import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import type { Preferences } from "./preferences";

export function useShellHover({
  prefs,
  expanded,
  pinned,
  beginMorph,
  onCollapse,
  onPreview,
}: {
  prefs: Preferences;
  expanded: boolean;
  pinned: boolean;
  beginMorph: () => void;
  onCollapse: () => void;
  onPreview: () => void;
}) {
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEnabled = useRef(true);

  const clearTimers = useCallback(() => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    enterTimer.current = null;
    leaveTimer.current = null;
  }, []);
  const setHoverEnabled = useCallback(
    (enabled: boolean) => {
      hoverEnabled.current = enabled;
      if (!enabled) clearTimers();
    },
    [clearTimers],
  );
  const handleEnter = (event: PointerEvent<HTMLElement>) => {
    if (!hoverEnabled.current) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (!pinned && !expanded && prefs.hoverExpand) {
      enterTimer.current = setTimeout(() => {
        enterTimer.current = null;
        beginMorph();
        onPreview();
      }, prefs.hoverDelay);
    }
  };
  const handleLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (!pinned && expanded) {
      leaveTimer.current = setTimeout(() => onCollapse(), prefs.leaveDelay);
    }
  };

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { clearTimers, handleEnter, handleLeave, setHoverEnabled };
}
