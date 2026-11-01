import type { AgentModelOption, AgentSnapshot, ProviderReadiness } from "../../platform/tauri";
import { Text } from "../../shared/ui";

function formatTokens(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      );
}

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
    <select
      id="otto-agent-model"
      value={value ?? ""}
      disabled={busy}
      onChange={(event) => onChange(event.target.value || null)}
      className="h-[35px] w-full rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2 text-otto-sm text-otto-text outline-none focus:border-otto-line-focused disabled:opacity-50"
    >
      {models.map((option) => (
        <option key={option.id} value={option.id}>
          {option.displayName}
        </option>
      ))}
    </select>
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
      <Text as="span" variant="meta" className="mb-2 block text-otto-muted-strong">
        Runtime
      </Text>
      <div className="grid grid-cols-1 gap-2.5 border-b border-otto-raised-deep pb-3 min-[360px]:grid-cols-2">
        <div className="min-w-0">
          <label className="block text-otto-sm text-otto-text-tertiary" htmlFor="otto-agent-model">
            Model
          </label>
          {readiness.models.length > 0 ? (
            <ModelSelect
              models={readiness.models}
              value={selectedModel}
              busy={busy}
              onChange={setModel}
            />
          ) : (
            <Text as="p" variant="status" className="m-0 text-otto-text-secondary">
              {selectedModel ?? "Provider-managed model"}
            </Text>
          )}
        </div>
        <div className="min-w-0">
          <label
            className="block text-otto-sm text-otto-text-tertiary"
            htmlFor="otto-agent-thinking"
          >
            Thinking effort
          </label>
          {efforts.length > 0 ? (
            <select
              id="otto-agent-thinking"
              value={selectedEffort}
              disabled={busy}
              onChange={(event) => setThinkingEffort(event.target.value || null)}
              className="h-[35px] w-full rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2 text-otto-sm text-otto-text outline-none focus:border-otto-line-focused disabled:opacity-50"
            >
              {efforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          ) : (
            <Text as="p" variant="status" className="m-0 text-otto-text-secondary">
              Provider-managed
            </Text>
          )}
        </div>
      </div>
      {observedUsage ? (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 pt-3 text-otto-sm">
          <dt className="text-otto-text-tertiary">Active model</dt>
          <dd>{snapshot.model ?? selectedModel ?? "Not detected"}</dd>
          <dt className="text-otto-text-tertiary">Thinking effort</dt>
          <dd>{snapshot.thinkingEffort ?? selectedEffort ?? "Unavailable"}</dd>
          <dt id="otto-context-used-label" className="text-otto-text-tertiary">
            Context used
          </dt>
          <dd>{formatTokens(contextUsed)}</dd>
          <dt className="text-otto-text-tertiary">Context window</dt>
          <dd>{formatTokens(contextWindow)}</dd>
          <dt className="text-otto-text-tertiary">Context remaining</dt>
          <dd>{formatTokens(contextRemaining)}</dd>
          <dt className="text-otto-text-tertiary">Session tokens</dt>
          <dd>{formatTokens(observedUsage?.sessionTokens)}</dd>
        </dl>
      ) : (
        <Text as="p" variant="caption" className="mt-3 text-otto-text-tertiary">
          Usage unavailable until the provider reports session statistics.
        </Text>
      )}
      {contextPercent != null && (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-otto-control"
          role="progressbar"
          aria-labelledby="otto-context-used-label"
          aria-valuenow={contextUsed ?? undefined}
          aria-valuemin={0}
          aria-valuemax={contextWindow ?? 0}
        >
          <span
            className="block h-full rounded-full bg-otto-line-focused transition-[width] duration-200"
            style={{ width: `${contextPercent}%` }}
          />
        </div>
      )}
    </section>
  );
}
