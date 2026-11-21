import { useRef } from "react";
import type {
  AgentProvider,
  AgentProviderDescriptor,
  AgentRateLimit,
  ProviderReadiness,
} from "../../../platform/tauri";
import { Button, ChoiceGroup, Text } from "../../../shared/ui";
import { ModelPicker } from "../settings/ModelPicker";
import { ProviderRateLimits } from "../settings/ProviderRateLimits";
import {
  formatEffortLabel,
  resolveSelectedEffort,
  resolveThinkingEfforts,
} from "../settings/model-usage";
import { EngineChipList } from "./EngineChipList";
import { usePopoverFit } from "./popover-fit";

export type HeaderRuntimeSwitcher = {
  providers: AgentProviderDescriptor[];
  readiness: ProviderReadiness;
  pinnedModels?: string[];
  rateLimits?: AgentRateLimit[];
  locked: boolean;
  onSelectProvider: (provider: AgentProvider) => void;
  onSelectModel: (model: string | null) => void;
  onTogglePinModel?: (modelId: string) => void;
  onSelectThinkingEffort: (effort: string | null) => void;
  onOpenSettings: () => void;
};

export function EngineQuickPopover({
  provider,
  model,
  thinkingEffort,
  switcher,
  autoFocusSearch = false,
  onOpenSettings,
}: {
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
  switcher: HeaderRuntimeSwitcher;
  autoFocusSearch?: boolean;
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

  const popoverRef = useRef<HTMLDivElement>(null);
  const maxHeight = usePopoverFit(true, "top", popoverRef);

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-labelledby="otto-quick-engine-title"
      style={maxHeight ? { maxHeight } : undefined}
      className="otto-scrollbar-hidden absolute left-0 top-full z-30 mt-1.5 w-[336px] max-w-[calc(100vw-36px)] overflow-y-auto rounded-otto-card border border-otto-line-strong bg-otto-surface p-3 shadow-lg"
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
            <ModelPicker
              id="otto-quick-model"
              models={models}
              value={selectedModel}
              pinnedModels={switcher.pinnedModels}
              onTogglePin={switcher.onTogglePinModel}
              busy={switcher.locked}
              compact
              autoFocusSearch={autoFocusSearch}
              onChange={switcher.onSelectModel}
            />
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
