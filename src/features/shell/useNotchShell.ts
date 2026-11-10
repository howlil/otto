import { useEffect } from "react";
import { nativeAvailable } from "../../platform/tauri";
import type { SubviewEscapeHandler } from "./useShellFocus";
import { useShellInteraction } from "./useShellInteraction";
import { useShellPlacement, type PlacementStatus } from "./useShellPlacement";
import { useShellPreferences } from "./useShellPreferences";
import { useShellShortcut } from "./useShellShortcut";
import { useModuleNavigation } from "./useModuleNavigation";

export type { PlacementStatus } from "./useShellPlacement";

export function useNotchShell(consumeEscape?: SubviewEscapeHandler) {
  const preferences = useShellPreferences();
  const placement = useShellPlacement(
    preferences.prefs,
    nativeAvailable,
    preferences.setPlacementPreference,
  );
  const interaction = useShellInteraction({
    prefs: preferences.prefs,
    surfaceKey: placement.placement.applied,
    consumeEscape,
  });
  useShellShortcut(() => {
    if (interaction.expanded) interaction.dismiss();
    else interaction.open(interaction.page);
  });
  const moduleNavigation = useModuleNavigation(
    interaction.page,
    interaction.setPage,
    interaction.clearTimers,
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        "otto.preferences.v1",
        JSON.stringify({ ...preferences.prefs, placement: placement.placement.applied }),
      );
    } catch {}
  }, [placement.placement.applied, preferences.prefs]);
  return {
    ...interaction,
    ...moduleNavigation,
    ...preferences,
    placement: placement.placement satisfies PlacementStatus,
    syncPlacement: placement.syncPlacement,
  };
}
