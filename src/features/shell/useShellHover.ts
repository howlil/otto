import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import type { Preferences } from "./preferences";
import { notchPointerPosition } from "../../platform/tauri/shell";

export function useShellHover({
  prefs,
  expanded,
  pinned,
  onCollapse,
  onPreview,
}: {
  prefs: Preferences;
  expanded: boolean;
  pinned: boolean;
  onCollapse: () => void;
  onPreview: () => void;
}) {
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEnabled = useRef(true);
  const leaveRevision = useRef(0);

  const clearTimers = useCallback(() => {
    leaveRevision.current += 1;
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
    leaveRevision.current += 1;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (!pinned && !expanded && prefs.hoverExpand) {
      enterTimer.current = setTimeout(() => {
        enterTimer.current = null;
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
    const revision = ++leaveRevision.current;
    const surface = event.currentTarget;
    if (!pinned && expanded) {
      const confirmLeave = async () => {
        leaveTimer.current = null;
        const point = await notchPointerPosition().catch(() => null);
        if (revision !== leaveRevision.current || !surface.isConnected) return;
        const hit = point ? document.elementFromPoint(point.x, point.y) : null;
        if (hit && surface.contains(hit)) {
          leaveTimer.current = setTimeout(
            () => void confirmLeave(),
            Math.max(16, prefs.leaveDelay),
          );
          return;
        }
        onCollapse();
      };
      leaveTimer.current = setTimeout(() => void confirmLeave(), prefs.leaveDelay);
    }
  };

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { clearTimers, handleEnter, handleLeave, setHoverEnabled };
}
