import { useRef } from "react";
import type {
  AgentProvider,
  AgentProviderDescriptor,
  AgentRateLimit,
  ProviderReadiness,
} from "../../../platform/tauri";
import { ChoiceGroup, Icon, Text, type IconName } from "../../../shared/ui";
import { ModelPicker } from "../settings/ModelPicker";
import { ProviderRateLimits } from "../settings/ProviderRateLimits";
import {
  effortHint,
  formatEffortLabel,
  modelMetadata,
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

function SectionHeader({
  icon,
  title,
  htmlFor,
  meta,
}: {
  icon: IconName;
  title: string;
  htmlFor?: string;
  meta?: string | null;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="flex shrink-0 items-center gap-1.5">
        <Icon name={icon} size={13} className="shrink-0 text-otto-text-tertiary" />
        <Text
          as={htmlFor ? "label" : "span"}
          variant="meta"
          htmlFor={htmlFor}
          className="font-medium text-otto-text-secondary"
        >
          {title}
        </Text>
      </span>
      {meta && (
        <Text
          as="span"
          variant="caption"
          className="min-w-0 truncate tabular-nums text-otto-text-tertiary"
        >
          {meta}
        </Text>
      )}
    </div>
  );
}

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
  const metadata = modelMetadata(selectedOption, null);
  const hint = selectedEffort ? effortHint(selectedEffort) : null;

  const popoverRef = useRef<HTMLDivElement>(null);
  const maxHeight = usePopoverFit(true, "top", popoverRef);

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-labelledby="otto-quick-engine-title"
      style={maxHeight ? { maxHeight } : undefined}
      className="otto-scrollbar-hidden absolute left-0 top-full z-30 mt-1.5 w-[348px] max-w-[calc(100vw-36px)] overflow-y-auto rounded-otto-card border border-otto-line-strong bg-otto-surface p-3 shadow-lg"
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
          <SectionHeader icon="assistant" title="AI Engine" />
          <EngineChipList
            installed={installed}
            provider={provider}
            locked={switcher.locked}
            onSelect={switcher.onSelectProvider}
          />
        </div>
        {models.length > 0 && (
          <div className="min-w-0">
            <SectionHeader icon="cpu" title="Model" htmlFor="otto-quick-model" meta={metadata} />
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
            <SectionHeader icon="brain" title="Thinking effort" meta={hint} />
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
        <div className="border-t border-otto-line-soft pt-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-7 w-full items-center justify-between rounded-otto-chip border-0 bg-transparent px-2 text-otto-xs font-medium text-otto-text-secondary transition-colors duration-150 hover:bg-otto-control hover:text-otto-text-bright focus-visible:outline-1 focus-visible:outline-otto-line-focused"
          >
            <span className="flex items-center gap-1.5">
              <Icon name="settings" size={13} className="text-otto-text-tertiary" />
              <span>All engines & profile</span>
            </span>
            <Icon name="chevronRight" size={13} className="text-otto-text-tertiary" />
          </button>
        </div>
      </div>
    </div>
  );
}
