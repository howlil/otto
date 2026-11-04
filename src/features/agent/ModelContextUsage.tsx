import { Text } from "../../shared/ui";

function formatTokens(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      );
}

export function ModelContextUsage({
  available,
  contextUsed,
  contextWindow,
  contextRemaining,
  contextPercent,
  sessionTokens,
}: {
  available: boolean;
  contextUsed: number | null | undefined;
  contextWindow: number | null | undefined;
  contextRemaining: number | null;
  contextPercent: number | null;
  sessionTokens: number | null | undefined;
}) {
  if (!available) return null;
  return (
    <>
      <div className="pt-3">
        <Text as="span" variant="meta" className="mb-2 block text-otto-muted-strong">
          Context
        </Text>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-otto-sm">
          <dt id="otto-context-used-label" className="text-otto-text-tertiary">
            Context used
          </dt>
          <dd>{formatTokens(contextUsed)}</dd>
          <dt className="text-otto-text-tertiary">Context window</dt>
          <dd>{formatTokens(contextWindow)}</dd>
          <dt className="text-otto-text-tertiary">Context remaining</dt>
          <dd>{formatTokens(contextRemaining)}</dd>
          <dt className="text-otto-text-tertiary">Session tokens</dt>
          <dd>{formatTokens(sessionTokens)}</dd>
        </dl>
      </div>
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
            className="block h-full w-full origin-left rounded-full bg-otto-line-focused motion-safe:transition-transform motion-safe:duration-200"
            style={{ transform: `scaleX(${contextPercent / 100})` }}
          />
        </div>
      )}
    </>
  );
}
