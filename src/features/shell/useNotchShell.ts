import { useEffect } from "react";
import { nativeAvailable } from "../../platform/tauri";
import type { SubviewEscapeHandler } from "./useShellFocus";
import { useShellInteraction } from "./useShellInteraction";
import { useShellPlacement, type PlacementStatus } from "./useShellPlacement";
import { useShellPreferences } from "./useShellPreferences";

export type { PlacementStatus } from "./useShellPlacement";

export function useNotchShell(consumeEscape?: SubviewEscapeHandler) {
  const preferences = useShellPreferences();
  const placement = useShellPlacement(
    preferences.prefs,
    nativeAvailable,
    preferences.setPlacementPreference,
  );
  const interaction = useShellInteraction({ prefs: preferences.prefs, consumeEscape });

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
    ...preferences,
    placement: placement.placement satisfies PlacementStatus,
    syncPlacement: placement.syncPlacement,
  };
}
