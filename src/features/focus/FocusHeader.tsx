import { useEffect, useRef } from "react";
import type { TimerSnapshot } from "../../platform/tauri/focus";
import { Eyes, IconButton, Text, VisuallyHidden } from "../../shared/ui";
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
  const settingsButton = useRef<HTMLButtonElement>(null);
  const previousSettings = useRef(settings);
  useEffect(() => {
    if (previousSettings.current && !settings) {
      settingsButton.current?.focus({ preventScroll: true });
    }
    previousSettings.current = settings;
  }, [settings]);
  const statusTone = {
    ready: "bg-otto-focus-ready",
    running: "bg-otto-focus-running",
    paused: "bg-otto-focus-paused",
    completed: "bg-otto-focus-running",
  }[snapshot.status];
  return (
    <header className="flex h-[42px] shrink-0 items-center gap-[9px] border-b border-otto-focus-line px-[17px]">
      <button
        type="button"
        className="otto-focus-home grid h-[29px] w-8 shrink-0 place-items-center rounded-otto-panel border-0 bg-otto-raised transition-colors duration-150 hover:bg-otto-line-mid"
        onClick={onHome}
      >
        <Eyes mini />
        <VisuallyHidden>Back to Home</VisuallyHidden>
      </button>
      <Text as="strong" variant="title" className="min-w-0 flex-1 truncate font-[550]!">
        Focus timer
      </Text>
      <span className="inline-flex shrink-0 items-center gap-[7px] text-otto-focus-secondary">
        <i className={`h-1.5 w-1.5 rounded-full ${statusTone}`} aria-hidden="true" />
        <Text as="span" variant="status">
          {statusLabel(snapshot.status)}
        </Text>
      </span>
      <IconButton
        ref={settingsButton}
        icon={settings ? "close" : "durationSettings"}
        label={settings ? "Close duration settings" : "Edit durations"}
        variant="quiet"
        onClick={settings ? onSettingsBack : onSettings}
      />
    </header>
  );
}
