import { useCallback, useRef, useState } from "react";
import type { Page, Preferences } from "./preferences";
import { useShellFocus, type SubviewEscapeHandler } from "./useShellFocus";
import { useShellHover } from "./useShellHover";

export function useShellInteraction({
  prefs,
  consumeEscape,
}: {
  prefs: Preferences;
  consumeEscape?: SubviewEscapeHandler;
}) {
  const [page, setPage] = useState<Page>("home");
  const [mode, setMode] = useState<"compact" | "preview" | "pinned">("compact");
  const [eventMotion, setEventMotion] = useState("");
  const collapseRef = useRef<() => void>(() => {});
  const expanded = mode !== "compact";
  const pinned = mode === "pinned";
  const reducedMotion =
    prefs.motion === "reduced" ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const isAgent = page === "agent" || page === "agent-settings";
  const isMusic = page === "music";

  const requestCollapse = useCallback(() => collapseRef.current(), []);
  const hover = useShellHover({
    prefs,
    expanded,
    pinned,
    onCollapse: requestCollapse,
    onPreview: () => setMode("preview"),
  });
  const collapse = useCallback(() => {
    hover.clearTimers();
    setMode("compact");
    setPage((current) =>
      current === "global-settings"
        ? "home"
        : current === "agent-settings"
          ? "agent"
          : current === "focus-settings"
            ? "focus"
            : current,
    );
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
  const pin = useCallback(() => {
    hover.clearTimers();
    setMode((current) => (current === "preview" ? "pinned" : current));
  }, [hover.clearTimers]);
  const back = useCallback(() => {
    setPage("home");
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
    consumeEscape,
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
    isMusic,
    compactButton: focus.compactButton,
    homeGear: focus.homeGear,
    collapse,
    dismiss,
    open,
    back,
    clearTimers: hover.clearTimers,
    handleEnter: hover.handleEnter,
    handleLeave: hover.handleLeave,
    handleEscape: focus.handleEscape,
    setHoverEnabled: hover.setHoverEnabled,
  };
}
