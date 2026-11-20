import type {
  AgentModelOption,
  AgentProvider,
  AgentSnapshot,
  ProviderReadiness,
} from "../../../platform/tauri";
import { Button, SelectField, Text } from "../../../shared/ui";
import { resolveRateLimits } from "../model/rate-limits";
import { ModelContextUsage } from "./ModelContextUsage";
import { ProviderRateLimits } from "./ProviderRateLimits";
import { ThinkingEffortField } from "./ThinkingEffortField";
import { modelMetadata, resolveSelectedEffort, resolveThinkingEfforts } from "./model-usage";

function ModelSelect({
  models,
  value,
  busy,
  onChange,
}: {
  models: AgentModelOption[];
  value: string | null;
  busy: boolean;
  onChange: (value: string | null) => void;
}) {
  const selectedModelIsAvailable = models.some((option) => option.id === value);
  return (
    <SelectField
      id="otto-agent-model"
      value={selectedModelIsAvailable ? (value ?? "") : ""}
      disabled={busy}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="" disabled>
        {value && !selectedModelIsAvailable ? "Configured model unavailable" : "Choose a model"}
      </option>
      {models.map((option) => (
        <option key={option.id} value={option.id}>
          {option.displayName}
        </option>
      ))}
    </SelectField>
  );
}

function ModelSection({
  readinessStatus,
  models,
  value,
  observedModel,
  metadata,
  busy,
  onChange,
  onRetry,
}: {
  readinessStatus: ProviderReadiness["status"];
  models: AgentModelOption[];
  value: string | null;
  observedModel: string | null;
  metadata: string | null;
  busy: boolean;
  onChange: (value: string | null) => void;
  onRetry: () => void;
}) {
  const selectable = models.length > 0;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Text
          as={selectable ? "label" : "span"}
          variant="label"
          className="text-otto-text-secondary"
          htmlFor={selectable ? "otto-agent-model" : undefined}
        >
          Model
        </Text>
        <span className="flex shrink-0 items-baseline gap-2">
          {metadata && (
            <Text as="span" variant="meta" className="tabular-nums text-otto-text-tertiary">
              {metadata}
            </Text>
          )}
          <Button
            variant="quiet"
            size="link"
            className="text-otto-text-tertiary"
            disabled={readinessStatus === "checking"}
            onClick={onRetry}
          >
            Refresh models
          </Button>
        </span>
      </div>
      {selectable ? (
        <ModelSelect models={models} value={value} busy={busy} onChange={onChange} />
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
            {observedModel ?? value ?? "Provider default"}
          </Text>
          <Text as="span" variant="meta" className="shrink-0 text-otto-text-tertiary">
            Native setting
          </Text>
        </div>
      )}
    </div>
  );
}

export function ModelUsageSettings({
  provider,
  readiness,
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
          models={readiness.models}
          value={selectedModel}
          observedModel={snapshot.model}
          metadata={metadata}
          busy={busy}
          onChange={setModel}
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
