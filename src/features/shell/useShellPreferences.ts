import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOverlayProtectionStatus,
  nativeAvailable,
  setOverlayCaptureProtection,
} from "../../platform/tauri/overlay";
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
  const osEventsError = useOsEventPreference(prefs.osEventsEnabled);
  const initialCapturePreference = useRef(prefs.hideFromCapture);
  const captureRequestActive = useRef(false);

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

  useEffect(() => {
    if (nativeAvailable) void setCaptureProtection(initialCapturePreference.current);
  }, [setCaptureProtection]);

  return {
    prefs,
    change,
    setPlacementPreference,
    captureProtected,
    captureProtectionSupported: nativeAvailable,
    captureProtectionPending,
    captureProtectionError,
    setCaptureProtection,
    osEventsError,
  };
}
