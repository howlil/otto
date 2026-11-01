export type AgentSettingsTab = "provider" | "mode" | "workspace" | "capture" | "usage";

const tabs: ReadonlyArray<{ id: AgentSettingsTab; label: string }> = [
  { id: "provider", label: "Provider" },
  { id: "mode", label: "Mode" },
  { id: "usage", label: "Model & usage" },
  { id: "workspace", label: "Workspace" },
  { id: "capture", label: "Screen Capture" },
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
      className="flex flex-col gap-1 border-r border-otto-line-soft bg-otto-nav-bg px-2 py-[13px]"
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
          className={`min-h-[35px] rounded-otto-control px-2.5 text-left text-otto-sm transition-colors hover:bg-otto-control-deep hover:text-otto-text ${tab === item.id ? "bg-otto-control-deep text-otto-text" : "text-otto-text-tertiary"}`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
