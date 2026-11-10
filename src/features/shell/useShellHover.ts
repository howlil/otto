import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import type { Preferences } from "./preferences";
import { nativeAvailable, notchPointerPosition } from "../../platform/tauri/shell";

async function pointerHits(surface: HTMLElement): Promise<boolean | null> {
  if (!nativeAvailable) return surface.matches(":hover");
  const point = await notchPointerPosition().catch(() => null);
  if (!point) return null;
  const hit = document.elementFromPoint(point.x, point.y);
  return hit !== null && surface.contains(hit);
}

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
  const suppressed = useRef(false);
  const hoveredSurface = useRef<HTMLElement | null>(null);
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
  const rearmAfterLeave = useCallback((surface: HTMLElement) => {
    const revision = leaveRevision.current;
    void pointerHits(surface).then((inside) => {
      if (revision === leaveRevision.current && surface.isConnected && inside === false) {
        suppressed.current = false;
      }
    });
  }, []);
  const suppressUntilLeave = useCallback(() => {
    clearTimers();
    const surface = hoveredSurface.current;
    if (!surface) return;
    suppressed.current = true;
    rearmAfterLeave(surface);
  }, [clearTimers, rearmAfterLeave]);

  const handleEnter = (event: PointerEvent<HTMLElement>) => {
    if (!hoverEnabled.current) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    hoveredSurface.current = event.currentTarget;
    leaveRevision.current += 1;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (!suppressed.current && !pinned && !expanded && prefs.hoverExpand) {
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
    if (suppressed.current) rearmAfterLeave(surface);
    if (!pinned && expanded) {
      const confirmLeave = async () => {
        leaveTimer.current = null;
        const inside = await pointerHits(surface);
        if (revision !== leaveRevision.current || !surface.isConnected) return;
        if (inside) {
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

  return { clearTimers, handleEnter, handleLeave, setHoverEnabled, suppressUntilLeave };
}
