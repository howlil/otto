import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { nativeAvailable } from "../../platform/tauri";
import { readPreferences, type Page, type Preferences } from "./preferences";

// Shell behavior for the notch: page/expand/pin, the hover-intent timers,
// focus restoration, preference persistence and the surface request. It owns
// this state so the App component stays a composition, not a hook dump.
export function useNotchShell() {
  const [page, setPage] = useState<Page>("home");
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(readPreferences);
  const [notice, setNotice] = useState("");
  const [eventMotion, setEventMotion] = useState("");
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousPage = useRef<Page>(page);
  const compactButton = useRef<HTMLButtonElement>(null);
  const homeGear = useRef<HTMLButtonElement>(null);

  const reducedMotion =
    prefs.motion === "reduced" ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const isAgent = page === "agent" || page === "agent-settings";

  const clearTimers = useCallback(() => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    enterTimer.current = null;
    leaveTimer.current = null;
  }, []);
  const collapse = useCallback(() => {
    clearTimers();
    setExpanded(false);
    setPinned(false);
    setPage((p) => (p === "global-settings" ? "home" : p === "agent-settings" ? "agent" : p));
  }, [clearTimers]);
  const open = useCallback(
    (next: Page, pin = true) => {
      clearTimers();
      setPage(next);
      setExpanded(true);
      setPinned(pin);
      setNotice("");
    },
    [clearTimers],
  );
  const change = useCallback(
    (patch: Partial<Preferences>) => setPrefs((old) => ({ ...old, ...patch })),
    [],
  );
  const back = useCallback(() => setPage("home"), []);

  useEffect(() => {
    try {
      localStorage.setItem("otto.preferences.v1", JSON.stringify(prefs));
    } catch {
      /* optional */
    }
  }, [prefs]);
  useEffect(() => {
    if (previousPage.current === "global-settings" && page === "home")
      homeGear.current?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [page]);
  useEffect(() => {
    if (!nativeAvailable) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => {
          if (!payload && prefs.clickOutside && pinned) collapse();
        }),
      )
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [prefs.clickOutside, pinned, collapse]);
  useEffect(() => () => clearTimers(), [clearTimers]);

  const handleEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (!pinned && !expanded && prefs.hoverExpand) {
      enterTimer.current = setTimeout(() => {
        setExpanded(true);
        setNotice("");
      }, prefs.hoverDelay);
    }
  };
  const handleLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (!pinned && expanded) {
      leaveTimer.current = setTimeout(() => collapse(), prefs.leaveDelay);
    }
  };
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    if (page === "agent-settings") {
      setPage("agent");
      return;
    }
    if (page === "global-settings") {
      setPage("home");
      return;
    }
    collapse();
    requestAnimationFrame(() => compactButton.current?.focus({ preventScroll: true }));
  };

  return {
    page,
    setPage,
    expanded,
    pinned,
    setPinned,
    prefs,
    change,
    notice,
    setNotice,
    eventMotion,
    setEventMotion,
    reducedMotion,
    isAgent,
    compactButton,
    homeGear,
    collapse,
    open,
    back,
    clearTimers,
    handleEnter,
    handleLeave,
    handleEscape,
  };
}
