import type { AgentProvider, AgentProviderDescriptor } from "../../../platform/tauri";
import { Text } from "../../../shared/ui";
import { providerLabel } from "../history/history-model";

export function EngineChipList({
  installed,
  provider,
  locked,
  onSelect,
}: {
  installed: AgentProviderDescriptor[];
  provider: AgentProvider;
  locked: boolean;
  onSelect: (provider: AgentProvider) => void;
}) {
  if (installed.length === 0) {
    return (
      <Text as="p" variant="caption" className="m-0 text-otto-text-tertiary">
        No installed AI engines detected yet.
      </Text>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {installed.map((item) => {
        const active = item.id === provider;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            disabled={locked}
            onClick={() => onSelect(item.id)}
            className={`rounded-otto-chip border px-2 py-1 text-otto-xs transition-colors duration-150 disabled:opacity-50 ${
              active
                ? "border-otto-line-focused bg-otto-selected text-otto-text-bright"
                : "border-otto-line bg-otto-control text-otto-text-secondary hover:bg-otto-control-hover"
            }`}
          >
            {providerLabel(item.id)}
          </button>
        );
      })}
    </div>
  );
}
