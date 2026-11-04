import type { AgentModelOption, AgentSnapshot, ProviderReadiness } from "../../platform/tauri";
import { SelectField, Text } from "../../shared/ui";
import { ModelContextUsage } from "./ModelContextUsage";

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
  if (models.length === 0) return null;
  return (
    <SelectField
      id="otto-agent-model"
      value={value ?? ""}
      disabled={busy}
      onChange={(event) => onChange(event.target.value || null)}
    >
      {models.map((option) => (
        <option key={option.id} value={option.id}>
          {option.displayName}
        </option>
      ))}
    </SelectField>
  );
}

function ModelField({
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
  return (
    <div className="min-w-0">
      <Text
        as="label"
        variant="label"
        className="mb-1.5 block text-otto-text-secondary"
        htmlFor="otto-agent-model"
      >
        Model
      </Text>
      {models.length > 0 ? (
        <ModelSelect models={models} value={value} busy={busy} onChange={onChange} />
      ) : (
        <Text
          as="p"
          variant="status"
          className="m-0 flex min-h-[35px] items-center text-otto-text-secondary"
        >
          {value ?? "Provider-managed model"}
        </Text>
      )}
    </div>
  );
}

function ThinkingField({
  efforts,
  value,
  busy,
  onChange,
}: {
  efforts: string[];
  value: string;
  busy: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="min-w-0">
      <Text
        as="label"
        variant="label"
        className="mb-1.5 block text-otto-text-secondary"
        htmlFor="otto-agent-thinking"
      >
        Thinking effort
      </Text>
      {efforts.length > 0 ? (
        <SelectField
          id="otto-agent-thinking"
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value || null)}
        >
          {efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </SelectField>
      ) : (
        <Text
          as="p"
          variant="status"
          className="m-0 flex min-h-[35px] items-center text-otto-text-secondary"
        >
          Provider-managed
        </Text>
      )}
    </div>
  );
}

export function ModelUsageSettings({
  readiness,
  snapshot,
  model,
  setModel,
  thinkingEffort,
  setThinkingEffort,
  busy,
}: {
  readiness: ProviderReadiness;
  snapshot: AgentSnapshot;
  model: string | null;
  setModel: (model: string | null) => void;
  thinkingEffort: string | null;
  setThinkingEffort: (effort: string | null) => void;
  busy: boolean;
}) {
  const selectedModel = model ?? readiness.model;
  const observedUsage = selectedModel && snapshot.model === selectedModel ? snapshot.usage : null;
  const selectedOption = readiness.models.find((option) => option.id === selectedModel);
  const efforts = selectedOption?.thinkingEfforts ?? readiness.thinkingEfforts;
  const selectedEffort =
    thinkingEffort ?? selectedOption?.defaultThinkingEffort ?? readiness.thinkingEffort ?? "";
  const contextUsed = observedUsage?.contextTokens;
  const contextWindow = observedUsage?.modelContextWindow ?? selectedOption?.contextWindow;
  const contextRemaining =
    contextUsed != null && contextWindow != null ? Math.max(0, contextWindow - contextUsed) : null;
  const contextPercent =
    contextUsed != null && contextWindow != null && contextWindow > 0
      ? Math.min(100, (contextUsed / contextWindow) * 100)
      : null;
  return (
    <section aria-labelledby="otto-model-usage-title">
      <h2 id="otto-model-usage-title" className="sr-only">
        Model and context usage
      </h2>
      <div className="grid grid-cols-1 gap-4 border-b border-otto-raised-deep pb-3 min-[360px]:grid-cols-2">
        <ModelField
          models={readiness.models}
          value={selectedModel}
          busy={busy}
          onChange={setModel}
        />
        <ThinkingField
          efforts={efforts}
          value={selectedEffort}
          busy={busy}
          onChange={setThinkingEffort}
        />
      </div>
      <ModelContextUsage
        available={observedUsage != null}
        contextUsed={contextUsed}
        contextWindow={contextWindow}
        contextRemaining={contextRemaining}
        contextPercent={contextPercent}
        sessionTokens={observedUsage?.sessionTokens}
      />
    </section>
  );
}
