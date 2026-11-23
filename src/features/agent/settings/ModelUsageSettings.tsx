import type {
  AgentModelOption,
  AgentProvider,
  AgentSnapshot,
  ProviderReadiness,
} from "../../../platform/tauri";
import { Icon, IconButton, Text } from "../../../shared/ui";
import { resolveRateLimits } from "../model/rate-limits";
import { ModelContextUsage } from "./ModelContextUsage";
import { ModelPicker } from "./ModelPicker";
import { ProviderRateLimits } from "./ProviderRateLimits";
import { ThinkingEffortField } from "./ThinkingEffortField";
import { modelMetadata, resolveSelectedEffort, resolveThinkingEfforts } from "./model-usage";

function ModelSection({
  readinessStatus,
  refreshing,
  models,
  pinnedModels,
  value,
  observedModel,
  metadata,
  busy,
  onChange,
  onTogglePin,
  onRetry,
}: {
  readinessStatus: ProviderReadiness["status"];
  refreshing?: boolean;
  models: AgentModelOption[];
  pinnedModels?: string[];
  value: string | null;
  observedModel: string | null;
  metadata: string | null;
  busy: boolean;
  onChange: (value: string | null) => void;
  onTogglePin?: (modelId: string) => void;
  onRetry: () => void;
}) {
  const selectable = models.length > 0;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center text-otto-text-tertiary">
            <Icon name="cpu" size={14} />
          </span>
          <Text
            as={selectable ? "label" : "span"}
            variant="label"
            className="text-otto-text-secondary"
            htmlFor={selectable ? "otto-agent-model" : undefined}
          >
            Model
          </Text>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {metadata && (
            <Text as="span" variant="meta" className="tabular-nums text-otto-text-tertiary">
              {metadata}
            </Text>
          )}
          <IconButton
            icon="refresh"
            label="Refresh models"
            title={refreshing ? "Refreshing models…" : "Refresh models"}
            variant="quiet"
            size={14}
            className={refreshing ? "[&_svg]:animate-spin" : ""}
            disabled={readinessStatus === "checking" || Boolean(refreshing)}
            onClick={onRetry}
          />
        </span>
      </div>
      {selectable ? (
        <ModelPicker
          id="otto-agent-model"
          models={models}
          value={value}
          pinnedModels={pinnedModels}
          onTogglePin={onTogglePin}
          busy={busy}
          allowPlaceholder
          onChange={onChange}
        />
      ) : readinessStatus === "checking" ? (
        <Text
          as="p"
          variant="status"
          className="m-0 flex min-h-[35px] items-center text-otto-text-tertiary"
        >
          Checking available models…
        </Text>
      ) : (
        <div className="flex min-h-[35px] items-center justify-between gap-2 rounded-otto-control border border-otto-line-soft bg-otto-field-deep px-2.5">
          <Text as="span" variant="status" className="min-w-0 truncate text-otto-text-bright">
            {observedModel ?? value ?? "Engine default"}
          </Text>
          <Text as="span" variant="meta" className="shrink-0 text-otto-text-tertiary">
            Set by the engine
          </Text>
        </div>
      )}
    </div>
  );
}

export function ModelUsageSettings({
  provider,
  readiness,
  refreshing,
  pinnedModels,
  onTogglePinModel,
  snapshot,
  model,
  setModel,
  thinkingEffort,
  setThinkingEffort,
  busy,
  onRetry,
}: {
  provider?: AgentProvider;
  readiness: ProviderReadiness;
  refreshing?: boolean;
  pinnedModels?: string[];
  onTogglePinModel?: (modelId: string) => void;
  snapshot: AgentSnapshot;
  model: string | null;
  setModel: (model: string | null) => void;
  thinkingEffort: string | null;
  setThinkingEffort: (effort: string | null) => void;
  busy: boolean;
  onRetry: () => void;
}) {
  const selectedModel = model ?? readiness.model;
  const observedUsage = !selectedModel || snapshot.model === selectedModel ? snapshot.usage : null;
  const rateLimits = resolveRateLimits(provider, readiness, snapshot);
  const selectedOption = readiness.models.find((option) => option.id === selectedModel);
  const efforts = resolveThinkingEfforts(readiness, selectedOption);
  const selectedEffort = resolveSelectedEffort(readiness, selectedOption, thinkingEffort, efforts);
  const metadata = modelMetadata(selectedOption, observedUsage?.modelContextWindow);
  return (
    <section aria-labelledby="otto-model-usage-title" className="space-y-4">
      <h2 id="otto-model-usage-title" className="sr-only">
        Model and context usage
      </h2>
      <div className="space-y-4">
        <ModelSection
          readinessStatus={readiness.status}
          refreshing={refreshing}
          models={readiness.models}
          pinnedModels={pinnedModels}
          value={selectedModel}
          observedModel={snapshot.model}
          metadata={metadata}
          busy={busy}
          onChange={setModel}
          onTogglePin={onTogglePinModel}
          onRetry={onRetry}
        />
        <ThinkingEffortField
          efforts={efforts}
          value={selectedEffort}
          busy={busy}
          onChange={setThinkingEffort}
        />
      </div>
      <ModelContextUsage
        usage={observedUsage}
        fallbackContextWindow={selectedOption?.contextWindow}
      />
      <ProviderRateLimits rateLimits={rateLimits} />
    </section>
  );
}
