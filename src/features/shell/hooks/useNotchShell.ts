import { useEffect, useMemo } from "react";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { useShellInteraction } from "./useShellInteraction";
import { useShellPlacement, type PlacementStatus } from "./useShellPlacement";
import { useShellPreferences } from "./useShellPreferences";
import { useOttoOs, useOttoOsDock } from "./useOttoOs";
import { useShellShortcut } from "./useShellShortcut";
import { surfaceOpacityPercent } from "../model/preferences";
import type { ShellViewModel } from "../model/view-model";

export type { PlacementStatus } from "./useShellPlacement";

export function useNotchShell() {
  const preferences = useShellPreferences();
  const ottoOs = useOttoOs();
  const placement = useShellPlacement(
    preferences.prefs,
    nativeAvailable,
    preferences.setPlacementPreference,
    preferences.resetPanelPosition,
    ottoOs,
  );
  const docked = ottoOs && preferences.prefs.position === null;
  const interactionPrefs = useMemo(
    () => (docked ? { ...preferences.prefs, hoverExpand: false } : preferences.prefs),
    [docked, preferences.prefs],
  );
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
          placement: ottoOs ? preferences.prefs.placement : placement.placement.applied,
        }),
      );
    } catch {}
  }, [ottoOs, placement.placement.applied, preferences.prefs]);
  return {
    ...interaction,
    ...preferences,
    ottoOs,
    placement: placement.placement satisfies PlacementStatus,
    syncPlacement: placement.syncPlacement,
  } satisfies ShellViewModel;
}
