import type {
  AgentProvider,
  AgentProviderDescriptor,
  AgentRateLimit,
  ProviderReadiness,
} from "../../../platform/tauri";
import { Button, ChoiceGroup, SelectField, Text } from "../../../shared/ui";
import { providerLabel } from "../history/history-model";
import { ProviderRateLimits } from "../settings/ProviderRateLimits";
import {
  formatEffortLabel,
  resolveSelectedEffort,
  resolveThinkingEfforts,
} from "../settings/model-usage";

export type HeaderRuntimeSwitcher = {
  providers: AgentProviderDescriptor[];
  readiness: ProviderReadiness;
  rateLimits?: AgentRateLimit[];
  locked: boolean;
  onSelectProvider: (provider: AgentProvider) => void;
  onSelectModel: (model: string | null) => void;
  onSelectThinkingEffort: (effort: string | null) => void;
  onOpenSettings: () => void;
};

function EngineChipList({
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

export function EngineQuickPopover({
  provider,
  model,
  thinkingEffort,
  switcher,
  onOpenSettings,
}: {
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
  switcher: HeaderRuntimeSwitcher;
  onOpenSettings: () => void;
}) {
  const installed = Array.isArray(switcher.providers)
    ? switcher.providers.filter((item) => item.installed)
    : [];
  const models = Array.isArray(switcher.readiness.models) ? switcher.readiness.models : [];
  const selectedModel = model ?? switcher.readiness.model;
  const selectedOption = models.find((item) => item.id === selectedModel);
  const efforts = resolveThinkingEfforts(switcher.readiness, selectedOption);
  const selectedEffort = resolveSelectedEffort(
    switcher.readiness,
    selectedOption,
    thinkingEffort,
    efforts,
  );

  return (
    <div
      role="dialog"
      aria-labelledby="otto-quick-engine-title"
      className="absolute left-0 top-full z-30 mt-1.5 w-[296px] max-w-[calc(100vw-36px)] rounded-otto-card border border-otto-line-strong bg-otto-surface p-3 shadow-lg"
    >
      <h2 id="otto-quick-engine-title" className="sr-only">
        Switch AI engine and model
      </h2>
      <div className="space-y-3">
        {switcher.locked && (
          <Text as="p" variant="caption" className="m-0 text-otto-text-tertiary">
            Finish or stop the current answer to switch.
          </Text>
        )}
        <div className="min-w-0">
          <Text as="span" variant="meta" className="mb-1.5 block text-otto-text-secondary">
            AI Engine
          </Text>
          <EngineChipList
            installed={installed}
            provider={provider}
            locked={switcher.locked}
            onSelect={switcher.onSelectProvider}
          />
        </div>
        {models.length > 0 && (
          <div className="min-w-0">
            <Text
              as="label"
              variant="meta"
              htmlFor="otto-quick-model"
              className="mb-1 block text-otto-text-secondary"
            >
              Model
            </Text>
            <SelectField
              id="otto-quick-model"
              value={selectedModel ?? ""}
              disabled={switcher.locked}
              onChange={(event) => switcher.onSelectModel(event.target.value || null)}
            >
              {models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.displayName}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        {efforts.length > 0 && (
          <div className="min-w-0">
            <Text as="span" variant="meta" className="mb-1.5 block text-otto-text-secondary">
              Thinking effort
            </Text>
            <ChoiceGroup
              value={selectedEffort}
              choices={efforts.map((effort) => ({
                value: effort,
                label: formatEffortLabel(effort),
              }))}
              disabled={switcher.locked}
              onChange={(next) => {
                if (next !== selectedEffort) switcher.onSelectThinkingEffort(next);
              }}
            />
          </div>
        )}
        <ProviderRateLimits rateLimits={switcher.rateLimits ?? []} compact />
        <div className="flex items-center justify-end border-t border-otto-line-soft pt-2">
          <Button
            variant="quiet"
            size="link"
            className="text-otto-text-tertiary"
            onClick={onOpenSettings}
          >
            All engines & profile
          </Button>
        </div>
      </div>
    </div>
  );
}
