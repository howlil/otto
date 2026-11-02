import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  getOverlayProtectionStatus,
  setOverlayCaptureProtection,
  nativeAvailable,
  onNotchFocusChanged,
} from "../../platform/tauri";
import { readPreferences, type Page, type Preferences } from "./preferences";
import { shouldCollapseOnBlur } from "./surface";

type ShellMode = "compact" | "preview" | "pinned";

export function useNotchShell() {
  const [page, setPage] = useState<Page>("home");
  const [mode, setMode] = useState<ShellMode>("compact");
  const expanded = mode !== "compact";
  const pinned = mode === "pinned";
  const [prefs, setPrefs] = useState<Preferences>(readPreferences);
  const [notice, setNotice] = useState("");
  const [captureProtected, setCaptureProtected] = useState<boolean | null>(null);
  const [captureProtectionPending, setCaptureProtectionPending] = useState(nativeAvailable);
  const [captureProtectionError, setCaptureProtectionError] = useState<string | null>(null);
  const initialCapturePreference = useRef(prefs.hideFromCapture);
  const captureRequestActive = useRef(false);
  const [eventMotion, setEventMotion] = useState("");
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const morphUntil = useRef(0);
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
    morphUntil.current = 0;
    setMode("compact");
    setPage((p) => (p === "global-settings" ? "home" : p === "agent-settings" ? "agent" : p));
  }, [clearTimers]);
  const open = useCallback(
    (next: Page, pin = true) => {
      clearTimers();
      setPage(next);
      setMode(pin ? "pinned" : "preview");
      setNotice("");
    },
    [clearTimers],
  );
  const pin = useCallback(() => {
    clearTimers();
    setMode((current) => (current === "preview" ? "pinned" : current));
  }, [clearTimers]);
  const change = useCallback(
    (patch: Partial<Preferences>) => setPrefs((old) => ({ ...old, ...patch })),
    [],
  );
  const back = useCallback(() => setPage("home"), []);

  const setCaptureProtection = useCallback(async (enabled: boolean) => {
    if (!nativeAvailable || captureRequestActive.current) return;
    captureRequestActive.current = true;
    setCaptureProtectionPending(true);
    setCaptureProtectionError(null);
    try {
      const actual = await setOverlayCaptureProtection(enabled);
      if (actual !== enabled) throw new Error("Windows did not apply the requested protection.");
      setCaptureProtected(actual);
      setPrefs((current) => ({ ...current, hideFromCapture: actual }));
    } catch (error) {
      setCaptureProtectionError(error instanceof Error ? error.message : String(error));
      try {
        setCaptureProtected(await getOverlayProtectionStatus());
      } catch {
        setCaptureProtected(null);
      }
    } finally {
      captureRequestActive.current = false;
      setCaptureProtectionPending(false);
    }
  }, []);

  useEffect(() => {
    if (nativeAvailable) void setCaptureProtection(initialCapturePreference.current);
  }, [setCaptureProtection]);

  useEffect(() => {
    try {
      localStorage.setItem("otto.preferences.v1", JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  useEffect(() => {
    if (
      (previousPage.current === "global-settings" || previousPage.current === "agent-settings") &&
      page === "home"
    )
      homeGear.current?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [page]);
  useEffect(() => {
    if (!nativeAvailable) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void onNotchFocusChanged((focused) => {
      if (!focused && shouldCollapseOnBlur(mode, prefs.clickOutside)) collapse();
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [mode, prefs.clickOutside, collapse]);
  useEffect(() => () => clearTimers(), [clearTimers]);

  const handleEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }

    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (!pinned && !expanded && prefs.hoverExpand) {
      enterTimer.current = setTimeout(() => {
        enterTimer.current = null;
        morphUntil.current =
          performance.now() + (reducedMotion ? 0 : prefs.motion === "gentle" ? 300 : 420);
        setMode("preview");
        setNotice("");
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
      const settling = Math.max(0, morphUntil.current - performance.now());
      leaveTimer.current = setTimeout(() => collapse(), prefs.leaveDelay + settling);
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
    pin,
    prefs,
    change,
    notice,
    setNotice,
    captureProtected,
    captureProtectionPending,
    captureProtectionError,
    setCaptureProtection,
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
