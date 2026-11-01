export type AgentSettingsTab = "setup" | "capture";

const tabs: ReadonlyArray<{ id: AgentSettingsTab; label: string }> = [
  { id: "setup", label: "Setup" },
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
      className="flex min-h-0 shrink-0 flex-row gap-1 border-b border-otto-line-soft bg-otto-nav-bg px-3 py-2"
    >
      <span id="otto-agent-settings-sections" className="sr-only">
        Agent settings sections
      </span>
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={tab === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}
          className={`min-h-[35px] flex-1 rounded-otto-control px-2.5 text-center text-otto-sm transition-colors hover:bg-otto-control-deep hover:text-otto-text ${tab === item.id ? "bg-otto-control-deep text-otto-text" : "text-otto-text-tertiary"}`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
