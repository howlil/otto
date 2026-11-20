import { useCallback, useRef, useState } from "react";
import type { Page, Placement, Preferences } from "../model/preferences";
import { useShellFocus } from "./useShellFocus";
import { useShellHover } from "./useShellHover";
import { usePanelDrag } from "./usePanelDrag";
import { useSettingsNav } from "./useSettingsNav";

function prefersReducedMotion(motion: Preferences["motion"]): boolean {
  return (
    motion === "reduced" ||
    (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}

export function useShellInteraction({
  prefs,
  surfaceKey = "floating",
}: {
  prefs: Preferences;
  surfaceKey?: Placement;
}) {
  const [page, setPage] = useState<Page>("agent");
  const [mode, setMode] = useState<"compact" | "preview" | "pinned">("compact");
  const [eventMotion, setEventMotion] = useState("");
  const collapseRef = useRef<() => void>(() => {});
  const expanded = mode !== "compact";
  const pinned = mode === "pinned";
  const reducedMotion = prefersReducedMotion(prefs.motion);
  const isAgent = page === "agent" || page === "settings";

  const requestCollapse = useCallback(() => collapseRef.current(), []);
  const hover = useShellHover({
    prefs,
    expanded,
    pinned,
    surfaceKey,
    onCollapse: requestCollapse,
    onPreview: () => setMode("preview"),
  });
  const collapse = useCallback(() => {
    hover.clearTimers();
    setMode("compact");
    setPage("agent");
  }, [hover.clearTimers]);
  collapseRef.current = collapse;
  const open = useCallback(
    (next: Page, pin = true) => {
      hover.clearTimers();
      setPage(next);
      setMode(pin ? "pinned" : "preview");
    },
    [hover.clearTimers],
  );
  const settingsNav = useSettingsNav(() => open("settings"));
  const pin = useCallback(() => {
    hover.clearTimers();
    setMode((current) => (current === "preview" ? "pinned" : current));
  }, [hover.clearTimers]);
  const panelDrag = usePanelDrag({ surfaceKey, expanded, pinned, pin });
  const back = useCallback(() => {
    setPage("agent");
  }, []);
  const dismiss = useCallback(() => {
    collapse();
    hover.suppressUntilLeave();
  }, [collapse, hover.suppressUntilLeave]);
  const focus = useShellFocus({
    page,
    expanded,
    mode,
    clickOutside: prefs.clickOutside,
    setPage,
    collapse,
    dismiss,
  });
  const navigate = useCallback((next: Page) => setPage(next), []);
  return {
    page,
    setPage: navigate,
    expanded,
    pinned,
    pin,
    eventMotion,
    setEventMotion,
    reducedMotion,
    isAgent,
    compactButton: focus.compactButton,
    settingsButton: focus.settingsButton,
    ...settingsNav,
    collapse,
    dismiss,
    open,
    back,
    clearTimers: hover.clearTimers,
    handleEnter: hover.handleEnter,
    handleLeave: hover.handleLeave,
    handlePanelPointerDown: panelDrag.handlePointerDown,
    handlePanelPointerMove: panelDrag.handlePointerMove,
    handlePanelPointerUp: panelDrag.handlePointerUp,
    notePanelMove: panelDrag.noteMoved,
    isPanelDragging: panelDrag.isDragging,
    handleEscape: focus.handleEscape,
  };
}
