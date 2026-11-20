import { useCallback, useEffect, useRef, useState } from "react";
import { configureCaptureShortcut, getCaptureTargetTitle } from "../../../platform/tauri/capture";
import {
  configureCaptureAutoSend,
  configureTextCaptureShortcut,
} from "../../../platform/tauri/capture-staged";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { DEFAULT_CAPTURE_SHORTCUT, DEFAULT_TEXT_CAPTURE_SHORTCUT } from "./shortcut-keys";
import { useCaptureSource } from "./useCaptureSource";

function savedShortcut(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function savedAutoSend(): boolean {
  try {
    return localStorage.getItem("otto.capture.autoSend") === "true";
  } catch {
    return false;
  }
}

function useTargetTitle() {
  const [targetTitle, setTargetTitle] = useState<string | null>(null);
  const [targetWarning, setTargetWarning] = useState<string | null>(null);
  const [targetPending, setTargetPending] = useState(false);

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

  return { targetTitle, targetWarning, targetPending, refreshTarget };
}

function useTextAndAutoSendCapture(
  sourceReady: boolean,
  sourcePending: boolean,
  savingCapture: boolean,
  setSavingCapture: (saving: boolean) => void,
  setCaptureMessage: (message: string) => void,
) {
  const [textShortcut, setTextShortcut] = useState(() =>
    savedShortcut("otto.capture.textShortcut", DEFAULT_TEXT_CAPTURE_SHORTCUT),
  );
  const [autoSend, setAutoSendState] = useState<boolean>(savedAutoSend);
  const registeredTextShortcut = useRef(textShortcut);
  const initialAutoSend = useRef(autoSend);

  const saveTextShortcut = useCallback(
    async (next?: string) => {
      const value = next ?? textShortcut;
      if (!nativeAvailable || !sourceReady || sourcePending || savingCapture) return;
      setSavingCapture(true);
      try {
        await configureTextCaptureShortcut(value);
        setTextShortcut(value);
        registeredTextShortcut.current = value;
        try {
          localStorage.setItem("otto.capture.textShortcut", value);
          setCaptureMessage("Selected text shortcut active.");
        } catch {
          setCaptureMessage("Selected text shortcut active; preference could not be saved.");
        }
      } catch (cause) {
        setCaptureMessage(String(cause));
      } finally {
        setSavingCapture(false);
      }
    },
    [savingCapture, setCaptureMessage, setSavingCapture, sourcePending, sourceReady, textShortcut],
  );

  const setAutoSend = useCallback(
    async (next: boolean) => {
      setAutoSendState(next);
      try {
        localStorage.setItem("otto.capture.autoSend", next ? "true" : "false");
      } catch {}
      try {
        await configureCaptureAutoSend(next);
      } catch (cause) {
        setCaptureMessage(String(cause));
      }
    },
    [setCaptureMessage],
  );

  return {
    textShortcut,
    setTextShortcut,
    saveTextShortcut,
    autoSend,
    setAutoSend,
    registeredTextShortcut,
    initialAutoSend,
  };
}

export function useCaptureShortcut() {
  const [captureMessage, setCaptureMessage] = useState("");
  const target = useTargetTitle();
  const { source, selectSource, sourceReady, sourcePending } = useCaptureSource(setCaptureMessage);
  const [shortcut, setShortcut] = useState(() =>
    savedShortcut("otto.capture.shortcut", DEFAULT_CAPTURE_SHORTCUT),
  );
  const [savingCapture, setSavingCapture] = useState(false);
  const extra = useTextAndAutoSendCapture(
    sourceReady,
    sourcePending,
    savingCapture,
    setSavingCapture,
    setCaptureMessage,
  );
  const registeredShortcut = useRef(shortcut);
  const registered = useRef(false);

  useEffect(() => {
    if (!nativeAvailable || !sourceReady || registered.current) return;
    registered.current = true;
    setSavingCapture(true);
    void configureCaptureAutoSend(extra.initialAutoSend.current).catch(() => {});
    void configureTextCaptureShortcut(extra.registeredTextShortcut.current).catch(() => {});
    void configureCaptureShortcut(registeredShortcut.current)
      .catch((cause: unknown) => {
        registered.current = false;
        setCaptureMessage(String(cause));
      })
      .finally(() => setSavingCapture(false));
  }, [extra.initialAutoSend, extra.registeredTextShortcut, sourceReady]);

  const saveShortcut = useCallback(
    async (next?: string) => {
      const value = next ?? shortcut;
      if (!nativeAvailable || !sourceReady || sourcePending || savingCapture) return;
      setSavingCapture(true);
      try {
        await configureCaptureShortcut(value);
        setShortcut(value);
        registeredShortcut.current = value;
        registered.current = true;
        try {
          localStorage.setItem("otto.capture.shortcut", value);
          setCaptureMessage("Shortcut active. Focus another app and press it to capture.");
        } catch {
          setCaptureMessage("Shortcut active; preference could not be saved for next launch.");
        }
      } catch (cause) {
        setCaptureMessage(String(cause));
      } finally {
        setSavingCapture(false);
      }
    },
    [savingCapture, shortcut, sourcePending, sourceReady],
  );

  return {
    source,
    selectSource,
    ...target,
    sourceReady,
    sourcePending,
    shortcut,
    setShortcut,
    textShortcut: extra.textShortcut,
    setTextShortcut: extra.setTextShortcut,
    saveTextShortcut: extra.saveTextShortcut,
    autoSend: extra.autoSend,
    setAutoSend: extra.setAutoSend,
    captureMessage,
    savingCapture,
    available: nativeAvailable,
    saveShortcut,
  };
}
