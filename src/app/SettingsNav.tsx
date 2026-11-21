import type { KeyboardEvent } from "react";
import { ActiveIndicatorGroup, Icon, type IconName } from "../shared/ui";
import type { SettingsTab } from "../features/shell";

export const settingsTabs: ReadonlyArray<{ id: SettingsTab; label: string; icon: IconName }> = [
  { id: "assistant", label: "Assistant", icon: "assistant" },
  { id: "capture", label: "Capture", icon: "camera" },
  { id: "voice", label: "Voice", icon: "mic" },
  { id: "behavior", label: "Behavior", icon: "behavior" },
  { id: "position", label: "Position", icon: "position" },
  { id: "general", label: "General", icon: "general" },
];

export function SettingsNav({
  tab,
  onSelect,
}: {
  tab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}) {
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = settingsTabs.findIndex((item) => item.id === tab);
    const next = settingsTabs[(index + step + settingsTabs.length) % settingsTabs.length];
    onSelect(next.id);
    const rail = event.currentTarget;
    requestAnimationFrame(() =>
      rail.querySelector<HTMLElement>(`[data-active-key="${next.id}"]`)?.focus(),
    );
  };
  return (
    <nav aria-labelledby="otto-settings-sections" onKeyDown={move} className="px-2 py-3">
      <span id="otto-settings-sections" className="sr-only">
        Settings sections
      </span>
      <ActiveIndicatorGroup
        activeKey={tab}
        className="flex flex-col gap-1"
        indicatorClassName="rounded-otto-control bg-otto-control-deep"
      >
        {settingsTabs.map(({ id, label, icon }) => (
          <button
            type="button"
            key={id}
            data-active-key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => onSelect(id)}
            className={`relative z-[1] flex h-9 w-full items-center gap-2 rounded-otto-control border-0 bg-transparent px-2.5 text-left text-otto-sm transition-colors duration-[var(--otto-selection-duration)] ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${tab === id ? "text-otto-text" : "text-otto-label-muted hover:text-otto-text"}`}
          >
            <Icon name={icon} size={15} />
            {label}
          </button>
        ))}
      </ActiveIndicatorGroup>
    </nav>
  );
}
