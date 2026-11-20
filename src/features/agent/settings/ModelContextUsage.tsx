import type { AgentUsage } from "../../../platform/tauri";
import { Text } from "../../../shared/ui";
import { formatTokens } from "./model-usage";

function usageTone(percent: number | null) {
  if (percent != null && percent >= 95) {
    return { bar: "bg-otto-danger", text: "text-otto-danger" };
  }
  if (percent != null && percent >= 80) {
    return { bar: "bg-otto-warn", text: "text-otto-warn" };
  }
  return { bar: "bg-otto-line-focused", text: "text-otto-text-secondary" };
}

function ContextGauge({
  contextUsed,
  contextWindow,
}: {
  contextUsed: number | null;
  contextWindow: number | null;
}) {
  if (contextUsed == null && contextWindow == null) return null;
  const remaining =
    contextUsed != null && contextWindow != null ? Math.max(0, contextWindow - contextUsed) : null;
  const percent =
    contextUsed != null && contextWindow != null && contextWindow > 0
      ? Math.min(100, (contextUsed / contextWindow) * 100)
      : null;
  const tone = usageTone(percent);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Text
          as="span"
          variant="label"
          id="otto-context-used-label"
          className="text-otto-text-secondary"
        >
          Context
        </Text>
        <div className="flex items-baseline gap-2 tabular-nums">
          {contextUsed != null && contextWindow != null ? (
            <>
              <Text
                as="span"
                variant="status"
                className="font-medium text-otto-text-bright"
                title={`${contextUsed.toLocaleString("en-US")} / ${contextWindow.toLocaleString("en-US")} tokens`}
              >
                {`${formatTokens(contextUsed)} / ${formatTokens(contextWindow)}`}
              </Text>
              {percent != null && (
                <Text as="span" variant="meta" className={`font-medium ${tone.text}`}>
                  {`${Math.round(percent)}%`}
                </Text>
              )}
            </>
          ) : contextUsed != null ? (
            <Text
              as="span"
              variant="status"
              className="font-medium text-otto-text-bright"
              title={`${contextUsed.toLocaleString("en-US")} tokens`}
            >
              {`${formatTokens(contextUsed)} used`}
            </Text>
          ) : (
            <Text
              as="span"
              variant="status"
              className="text-otto-text-secondary"
              title={`${contextWindow?.toLocaleString("en-US")} tokens`}
            >
              {`${formatTokens(contextWindow)} window`}
            </Text>
          )}
        </div>
      </div>
      {percent != null && (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-otto-control"
          role="progressbar"
          aria-labelledby="otto-context-used-label"
          aria-valuenow={contextUsed ?? undefined}
          aria-valuemin={0}
          aria-valuemax={contextWindow ?? 0}
        >
          <span
            className={`block h-full w-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-200 ${tone.bar}`}
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </div>
      )}
      {remaining != null && (
        <Text
          as="p"
          variant="meta"
          className="m-0 mt-1.5 tabular-nums text-otto-text-tertiary"
          title={`${remaining.toLocaleString("en-US")} tokens remaining`}
        >
          {`${formatTokens(remaining)} remaining`}
        </Text>
      )}
    </div>
  );
}

function TokenBreakdown({ usage }: { usage: AgentUsage }) {
  const metrics: Array<{ label: string; value: number }> = [
    { label: "Session", value: usage.sessionTokens },
  ];
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    metrics.push({ label: "Input", value: usage.inputTokens });
    metrics.push({ label: "Output", value: usage.outputTokens });
  }
  if (usage.cachedInputTokens > 0) {
    metrics.push({ label: "Cached", value: usage.cachedInputTokens });
  }
  if (usage.reasoningOutputTokens != null && usage.reasoningOutputTokens > 0) {
    metrics.push({ label: "Reasoning", value: usage.reasoningOutputTokens });
  }
  return (
    <dl className="m-0 flex flex-wrap gap-x-5 gap-y-2">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-[56px]">
          <dt className="text-otto-xs leading-[1.35] text-otto-text-tertiary">{metric.label}</dt>
          <dd
            className="m-0 mt-0.5 text-otto-sm font-medium tabular-nums text-otto-text-bright"
            title={`${metric.value.toLocaleString("en-US")} tokens`}
          >
            {formatTokens(metric.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ModelContextUsage({
  usage,
  fallbackContextWindow,
}: {
  usage: AgentUsage | null;
  fallbackContextWindow: number | null | undefined;
}) {
  if (!usage) return null;
  const contextUsed = usage.contextTokens;
  const contextWindow = usage.modelContextWindow ?? fallbackContextWindow ?? null;
  return (
    <div className="space-y-3 pt-3">
      <ContextGauge contextUsed={contextUsed} contextWindow={contextWindow} />
      <TokenBreakdown usage={usage} />
    </div>
  );
}
