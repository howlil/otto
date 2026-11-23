import { useCallback, useRef, useState } from "react";
import type { NotchPlacement } from "../../../platform/tauri/shell";
import type { Placement, Preferences } from "../model/preferences";

export type PlacementStatus = {
  applied: Placement;
  requested: Placement;
  supported: boolean;
  ottoOs: boolean;
  ottoOsDetected: boolean;
  dockWithOttoOs: boolean;
  circleMode: boolean;
  error: string | null;
  attempt: number;
  change: (placement: Placement) => void;
  retry: () => void;
  resetPosition: () => void;
  setDockWithOttoOs: (dock: boolean) => void;
};

export function useShellPlacement({
  prefs,
  supported,
  setPlacementPreference,
  resetPosition,
  setDockWithOttoOs,
  ottoOs,
  ottoOsDetected,
}: {
  prefs: Preferences;
  supported: boolean;
  setPlacementPreference: (placement: Placement) => void;
  resetPosition: () => void;
  setDockWithOttoOs: (dock: boolean) => void;
  ottoOs: boolean;
  ottoOsDetected: boolean;
}) {
  const circleMode = prefs.compactStyle === "circle";
  const [appliedPlacement, setAppliedPlacement] = useState<Placement>("floating");
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placementAttempt, setPlacementAttempt] = useState(0);
  const requestedPlacement = useRef<Placement>(prefs.placement);
  requestedPlacement.current = prefs.placement;
  const floatingOverrideRef = useRef(ottoOsDetected || circleMode);
  floatingOverrideRef.current = ottoOsDetected || circleMode;

  const changePlacement = useCallback(
    (placement: Placement) => {
      setPlacementError(null);
      if (prefs.placement === placement) return;
      setPlacementPreference(placement);
    },
    [prefs.placement, setPlacementPreference],
  );
  const retryPlacement = useCallback(() => {
    setPlacementError(null);
    setPlacementAttempt((current) => current + 1);
  }, []);
  const syncPlacement = useCallback(
    (observed: NotchPlacement) => {
      setAppliedPlacement(observed);
      if (floatingOverrideRef.current || requestedPlacement.current === observed) {
        setPlacementError(null);
        return;
      }
      setPlacementError("Windows kept the previous notch placement.");
      setPlacementPreference(observed);
    },
    [setPlacementPreference],
  );

  return {
    placement: {
      applied: appliedPlacement,
      requested: prefs.placement,
      supported,
      ottoOs,
      ottoOsDetected,
      dockWithOttoOs: prefs.dockWithOttoOs,
      circleMode,
      error: placementError,
      attempt: placementAttempt,
      change: changePlacement,
      retry: retryPlacement,
      resetPosition,
      setDockWithOttoOs,
    } satisfies PlacementStatus,
    syncPlacement,
  };
}
