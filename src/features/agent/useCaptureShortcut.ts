import { useCallback, useEffect, useRef, useState } from "react";
import {
  configureCaptureShortcut,
  getCaptureTargetTitle,
  nativeAvailable,
} from "../../platform/tauri/capture";
import { useCaptureSource } from "./useCaptureSource";

export function useCaptureShortcut() {
  const [captureMessage, setCaptureMessage] = useState("");
  const [targetTitle, setTargetTitle] = useState<string | null>(null);
  const [targetWarning, setTargetWarning] = useState<string | null>(null);
  const [targetPending, setTargetPending] = useState(false);
  const { source, selectSource, sourceReady, sourcePending } = useCaptureSource(setCaptureMessage);
  const [shortcut, setShortcut] = useState(() => {
    try {
      return localStorage.getItem("otto.capture.shortcut") || "Ctrl+Shift+O";
    } catch {
      return "Ctrl+Shift+O";
    }
  });
  const [savingCapture, setSavingCapture] = useState(false);
  const refreshTarget = useCallback(async () => {
    if (!nativeAvailable) return;
    setTargetPending(true);
    try {
      const title = await getCaptureTargetTitle();
      setTargetTitle(title);
      setTargetWarning(null);
    } catch (cause) {
      setTargetTitle(null);
      setTargetWarning(String(cause));
    } finally {
      setTargetPending(false);
    }
  }, []);
  const registeredShortcut = useRef(shortcut);
  const registered = useRef(false);

  useEffect(() => {
    if (!nativeAvailable || !sourceReady || registered.current) return;
    registered.current = true;
    setSavingCapture(true);
    void configureCaptureShortcut(registeredShortcut.current)
      .catch((cause: unknown) => {
        registered.current = false;
        setCaptureMessage(String(cause));
      })
      .finally(() => setSavingCapture(false));
  }, [sourceReady]);

  const saveShortcut = useCallback(async () => {
    if (!nativeAvailable || !sourceReady || sourcePending || savingCapture) return;
    setSavingCapture(true);
    try {
      await configureCaptureShortcut(shortcut);
      registeredShortcut.current = shortcut;
      registered.current = true;
      try {
        localStorage.setItem("otto.capture.shortcut", shortcut);
        setCaptureMessage("Shortcut active. Focus another app and press it to capture.");
      } catch {
        setCaptureMessage("Shortcut active; preference could not be saved for next launch.");
      }
    } catch (cause) {
      setCaptureMessage(String(cause));
    } finally {
      setSavingCapture(false);
    }
  }, [savingCapture, shortcut, sourcePending, sourceReady]);

  return {
    source,
    selectSource,
    targetTitle,
    targetWarning,
    targetPending,
    refreshTarget,
    sourceReady,
    sourcePending,
    shortcut,
    setShortcut,
    captureMessage,
    savingCapture,
    available: nativeAvailable,
    saveShortcut,
  };
}
