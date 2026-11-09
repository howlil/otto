import type { TimerSnapshot } from "../../platform/tauri/focus";
import { IconButton, Text } from "../../shared/ui";
import { statusLabel } from "./view-model";

export function FocusHeader({
  snapshot,
  settings,
  onHome,
  onSettings,
  onSettingsBack,
}: {
  snapshot: TimerSnapshot;
  settings: boolean;
  onHome: () => void;
  onSettings: () => void;
  onSettingsBack: () => void;
}) {
  const statusTone = {
    ready: "bg-otto-muted",
    running: "bg-otto-ok",
    paused: "bg-otto-warn",
    completed: "bg-otto-completion-soft",
  }[snapshot.status];
  return (
    <header className="flex h-[49px] shrink-0 items-center gap-2 border-b border-otto-line-soft px-3.5">
      <IconButton icon="back" label="Back to Home" variant="outlined" onClick={onHome} />
      <Text as="strong" variant="title" className="min-w-0 flex-1 truncate">
        Focus timer
      </Text>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-otto-text-secondary">
        <i className={`h-[5px] w-[5px] rounded-full ${statusTone}`} aria-hidden="true" />
        <Text as="span" variant="status">
          {statusLabel(snapshot.status)}
        </Text>
      </span>
      <IconButton
        icon={settings ? "close" : "settings"}
        label={settings ? "Close duration settings" : "Edit durations"}
        variant="quiet"
        onClick={settings ? onSettingsBack : onSettings}
      />
    </header>
  );
}
