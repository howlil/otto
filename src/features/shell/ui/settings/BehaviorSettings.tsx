import { SettingRow, ShortcutRecorder, StatusMessage, Toggle } from "../../../../shared/ui";
import { useShortcutControls } from "../../hooks/useShortcutControls";
import type { Preferences } from "../../model/preferences";
import { DEFAULT_SHELL_SHORTCUT, recordShellShortcut } from "../../model/shortcut-keys";

export function BehaviorSettings({
  prefs,
  change,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  const { shortcut, message, busy, save, available } = useShortcutControls();
  return (
    <div className="space-y-1">
      <Toggle
        icon="behavior"
        title="Expand on hover"
        titleHint="Point at Otto to preview the composer"
        checked={prefs.hoverExpand}
        onChange={(hoverExpand) => change({ hoverExpand })}
      />
      <Toggle
        icon="pin"
        title="Keep expanded"
        titleHint="Stay open when you click elsewhere"
        checked={!prefs.clickOutside}
        onChange={(keepExpanded) => change({ clickOutside: !keepExpanded })}
      />
      <SettingRow
        icon="keyboard"
        title="Open / close shortcut"
        titleHint="Expand or collapse Otto from any app"
        htmlFor="otto-shell-shortcut"
      >
        <ShortcutRecorder
          id="otto-shell-shortcut"
          value={shortcut}
          defaultValue={DEFAULT_SHELL_SHORTCUT}
          disabled={!available || busy}
          record={recordShellShortcut}
          onRecord={(next) => void save(next)}
        />
      </SettingRow>
      {message && (
        <StatusMessage tone="warn" className="mt-1">
          {message}
        </StatusMessage>
      )}
    </div>
  );
}
