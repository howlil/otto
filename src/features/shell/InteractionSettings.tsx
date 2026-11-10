import { SettingsSection, Toggle } from "../../shared/ui";
import type { Preferences } from "./preferences";
import { ShortcutSettings } from "./ShortcutSettings";

export function InteractionSettings({
  prefs,
  change,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  return (
    <SettingsSection title="Interaction">
      <Toggle
        title="Expand on hover"
        checked={prefs.hoverExpand}
        onChange={(hoverExpand) => change({ hoverExpand })}
      />
      <Toggle
        title="Keep expanded"
        checked={!prefs.clickOutside}
        onChange={(keepExpanded) => change({ clickOutside: !keepExpanded })}
      />
      <ShortcutSettings />
    </SettingsSection>
  );
}
