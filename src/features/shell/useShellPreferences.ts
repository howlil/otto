import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOverlayProtectionStatus,
  nativeAvailable,
  setOverlayCaptureProtection,
} from "../../platform/tauri/overlay";
import { setTaskbarOttoMode } from "../../platform/tauri/taskbar";
import {
  confirmedCapturePreference,
  mergePreferences,
  readPreferences,
  type Preferences,
} from "./preferences";
import { useOsEventPreference } from "./useOsEventPreference";

export function useShellPreferences() {
  const [prefs, setPrefs] = useState<Preferences>(readPreferences);
  const [captureProtected, setCaptureProtected] = useState<boolean | null>(null);
  const [captureProtectionPending, setCaptureProtectionPending] = useState(nativeAvailable);
  const [captureProtectionError, setCaptureProtectionError] = useState<string | null>(null);
  const [taskbarReplacementPending, setTaskbarReplacementPending] = useState(
    nativeAvailable && prefs.replaceTaskbar,
  );
  const [taskbarReplacementError, setTaskbarReplacementError] = useState<string | null>(null);
  const osEventsError = useOsEventPreference(prefs.osEventsEnabled);
  const initialCapturePreference = useRef(prefs.hideFromCapture);
  const initialTaskbarPreference = useRef(prefs.replaceTaskbar);
  const captureRequestActive = useRef(false);
  const taskbarRequestActive = useRef(false);

  const change = useCallback(
    (patch: Partial<Preferences>) => setPrefs((old) => mergePreferences(old, patch)),
    [],
  );
  const setPlacementPreference = useCallback(
    (placement: Preferences["placement"]) =>
      setPrefs((current) =>
        current.placement === placement ? current : { ...current, placement },
      ),
    [],
  );
  const setCaptureProtection = useCallback(async (enabled: boolean) => {
    if (!nativeAvailable || captureRequestActive.current) return;
    captureRequestActive.current = true;
    setCaptureProtectionPending(true);
    setCaptureProtectionError(null);
    try {
      const actual = await setOverlayCaptureProtection(enabled);
      if (actual !== enabled) throw new Error("Windows did not apply the requested protection.");
      setCaptureProtected(actual);
      setPrefs((current) => confirmedCapturePreference(current, actual));
    } catch (error) {
      setCaptureProtectionError(error instanceof Error ? error.message : String(error));
      try {
        const confirmed = await getOverlayProtectionStatus();
        setCaptureProtected(confirmed);
        setPrefs((current) => confirmedCapturePreference(current, confirmed));
      } catch {
        setCaptureProtected(null);
      }
    } finally {
      captureRequestActive.current = false;
      setCaptureProtectionPending(false);
    }
  }, []);

  const setTaskbarReplacement = useCallback(async (enabled: boolean) => {
    if (!nativeAvailable || taskbarRequestActive.current) return;
    taskbarRequestActive.current = true;
    setTaskbarReplacementPending(true);
    setTaskbarReplacementError(null);
    try {
      const actual = await setTaskbarOttoMode(enabled);
      if (actual !== enabled) throw new Error("Windows did not apply Otto Dock mode.");
      setPrefs((current) => ({ ...current, replaceTaskbar: enabled }));
    } catch (error) {
      setTaskbarReplacementError(error instanceof Error ? error.message : String(error));
    } finally {
      taskbarRequestActive.current = false;
      setTaskbarReplacementPending(false);
    }
  }, []);

  useEffect(() => {
    if (nativeAvailable) void setCaptureProtection(initialCapturePreference.current);
  }, [setCaptureProtection]);

  useEffect(() => {
    if (nativeAvailable && initialTaskbarPreference.current) {
      void setTaskbarReplacement(true);
    }
  }, [setTaskbarReplacement]);

  return {
    prefs,
    change,
    setPlacementPreference,
    captureProtected,
    captureProtectionSupported: nativeAvailable,
    captureProtectionPending,
    captureProtectionError,
    setCaptureProtection,
    taskbarReplacementSupported: nativeAvailable,
    taskbarReplacementPending,
    taskbarReplacementError,
    setTaskbarReplacement,
    osEventsError,
  };
}
