import { useCallback, useEffect, useRef, useState } from "react";
import type { Page, Preferences } from "./preferences";
import { morphDuration } from "./motion";
import { useShellFocus } from "./useShellFocus";
import { useShellHover } from "./useShellHover";

export function useShellInteraction({ prefs }: { prefs: Preferences }) {
  const [page, setPage] = useState<Page>("home");
  const [mode, setMode] = useState<"compact" | "preview" | "pinned">("compact");
  const [eventMotion, setEventMotion] = useState("");
  const [morphing, setMorphing] = useState(false);
  const morphTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseRef = useRef<() => void>(() => {});
  const expanded = mode !== "compact";
  const pinned = mode === "pinned";
  const reducedMotion =
    prefs.motion === "reduced" ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const isAgent = page === "agent" || page === "agent-settings";

  const beginMorph = useCallback(() => {
    if (reducedMotion) {
      setMorphing(false);
      return;
    }
    setMorphing(true);
    if (morphTimer.current) clearTimeout(morphTimer.current);
    morphTimer.current = setTimeout(() => {
      morphTimer.current = null;
      setMorphing(false);
    }, morphDuration(prefs.motion));
  }, [prefs.motion, reducedMotion]);
  const requestCollapse = useCallback(() => collapseRef.current(), []);
  const hover = useShellHover({
    prefs,
    expanded,
    pinned,
    beginMorph,
    onCollapse: requestCollapse,
    onPreview: () => setMode("preview"),
  });
  const collapse = useCallback(() => {
    hover.clearTimers();
    beginMorph();
    setMode("compact");
    setPage((current) =>
      current === "global-settings" ? "home" : current === "agent-settings" ? "agent" : current,
    );
  }, [beginMorph, hover.clearTimers]);
  collapseRef.current = collapse;
  const open = useCallback(
    (next: Page, pin = true) => {
      hover.clearTimers();
      beginMorph();
      setPage(next);
      setMode(pin ? "pinned" : "preview");
    },
    [beginMorph, hover.clearTimers],
  );
  const pin = useCallback(() => {
    hover.clearTimers();
    setMode((current) => (current === "preview" ? "pinned" : current));
  }, [hover.clearTimers]);
  const back = useCallback(() => {
    beginMorph();
    setPage("home");
  }, [beginMorph]);
  const focus = useShellFocus({
    page,
    expanded,
    mode,
    clickOutside: prefs.clickOutside,
    setPage,
    collapse,
  });
  const navigate = useCallback(
    (next: Page) => {
      beginMorph();
      setPage(next);
    },
    [beginMorph],
  );

  useEffect(
    () => () => {
      if (morphTimer.current) clearTimeout(morphTimer.current);
      morphTimer.current = null;
    },
    [],
  );

  return {
    page,
    setPage: navigate,
    expanded,
    pinned,
    morphing,
    pin,
    eventMotion,
    setEventMotion,
    reducedMotion,
    isAgent,
    compactButton: focus.compactButton,
    homeGear: focus.homeGear,
    collapse,
    open,
    back,
    clearTimers: hover.clearTimers,
    handleEnter: hover.handleEnter,
    handleLeave: hover.handleLeave,
    handleEscape: focus.handleEscape,
    setHoverEnabled: hover.setHoverEnabled,
  };
}
