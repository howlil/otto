import { ActiveIndicatorGroup } from "../../shared/ui";

export type AgentSettingsTab = "assistant" | "capture";

const tabs: ReadonlyArray<{ id: AgentSettingsTab; label: string }> = [
  { id: "assistant", label: "Assistant" },
  { id: "capture", label: "Capture" },
];

export function AgentSettingsNavigation({
  tab,
  onSelect,
}: {
  tab: AgentSettingsTab;
  onSelect: (tab: AgentSettingsTab) => void;
}) {
  return (
    <nav
      aria-labelledby="otto-agent-settings-sections"
      className="flex min-h-0 shrink-0 flex-row gap-1 border-b border-otto-line-soft bg-otto-nav-bg px-4 py-2"
    >
      <span id="otto-agent-settings-sections" className="sr-only">
        Agent settings sections
      </span>
      <ActiveIndicatorGroup
        activeKey={tab}
        className="flex min-w-0 flex-1 gap-1"
        indicatorClassName="rounded-otto-control bg-otto-control-deep"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            data-active-key={item.id}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
            className={`relative z-[1] min-h-[35px] flex-1 rounded-otto-control px-2.5 text-center text-otto-sm transition-colors duration-[var(--otto-selection-duration)] ease-otto hover:bg-otto-control-hover hover:text-otto-text ${tab === item.id ? "text-otto-text" : "text-otto-text-tertiary"}`}
          >
            {item.label}
          </button>
        ))}
      </ActiveIndicatorGroup>
    </nav>
  );
}
