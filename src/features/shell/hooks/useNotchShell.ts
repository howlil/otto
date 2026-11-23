import { useCallback, useEffect, useMemo } from "react";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { useShellInteraction } from "./useShellInteraction";
import { useShellPlacement, type PlacementStatus } from "./useShellPlacement";
import { useShellPreferences } from "./useShellPreferences";
import { useOttoOs, useOttoOsDock } from "./useOttoOs";
import { useShellShortcut } from "./useShellShortcut";
import { surfaceOpacityPercent, type PanelPosition } from "../model/preferences";
import type { ShellViewModel } from "../model/view-model";

export type { PlacementStatus } from "./useShellPlacement";

export function useNotchShell(options?: { onDragEnd?: (position: PanelPosition) => void }) {
  const preferences = useShellPreferences();
  const ottoOsDetected = useOttoOs();
  const ottoOs = ottoOsDetected && preferences.prefs.dockWithOttoOs;
  const circleMode = preferences.prefs.compactStyle === "circle";
  const compactCircle = ottoOs || circleMode;
  const placement = useShellPlacement({
    prefs: preferences.prefs,
    supported: nativeAvailable,
    setPlacementPreference: preferences.setPlacementPreference,
    resetPosition: preferences.resetPanelPosition,
    setDockWithOttoOs: preferences.setDockWithOttoOs,
    ottoOs,
    ottoOsDetected,
  });
  const docked = ottoOs && preferences.prefs.position === null;
  const interactionPrefs = useMemo(
    () => (docked ? { ...preferences.prefs, hoverExpand: false } : preferences.prefs),
    [docked, preferences.prefs],
  );
  const toggleCompactStyle = useCallback(() => {
    if (ottoOs) return;
    preferences.change({
      compactStyle: preferences.prefs.compactStyle === "circle" ? "capsule" : "circle",
    });
  }, [ottoOs, preferences.change, preferences.prefs.compactStyle]);
  useOttoOsDock(ottoOs && !docked, preferences.resetPanelPosition);
  const surfaceOpacity = surfaceOpacityPercent(preferences.prefs);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-otto-os", ottoOs);
  }, [ottoOs]);
  useEffect(() => {
    document.documentElement.style.setProperty("--otto-surface-opacity", `${surfaceOpacity}%`);
  }, [surfaceOpacity]);
  const interaction = useShellInteraction({
    prefs: interactionPrefs,
    surfaceKey: placement.placement.applied,
    onDragEnd: options?.onDragEnd,
  });
  useShellShortcut(() => {
    if (interaction.expanded) interaction.dismiss();
    else interaction.open(interaction.page);
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "otto.preferences.v1",
        JSON.stringify({
          ...preferences.prefs,
          placement:
            compactCircle || ottoOsDetected
              ? preferences.prefs.placement
              : placement.placement.applied,
        }),
      );
    } catch {}
  }, [compactCircle, ottoOsDetected, placement.placement.applied, preferences.prefs]);
  return {
    ...interaction,
    ...preferences,
    ottoOs,
    ottoOsDetected,
    compactCircle,
    toggleCompactStyle,
    placement: placement.placement satisfies PlacementStatus,
    syncPlacement: placement.syncPlacement,
  } satisfies ShellViewModel;
}
