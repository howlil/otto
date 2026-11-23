import type { AgentRateLimit } from "../../../platform/tauri";
import { Icon, Text } from "../../../shared/ui";
import { formatResetTime, rateLimitDisplayLabel, rateLimitTone } from "../model/rate-limits";

function rateLimitListClass(compact: boolean, count: number): string {
  if (!compact) return "space-y-2.5";
  return count > 1 ? "grid grid-cols-2 gap-2" : "space-y-2";
}

function RateLimitRow({
  limit,
  compact,
  now,
}: {
  limit: AgentRateLimit;
  compact: boolean;
  now: number;
}) {
  const used = Math.max(0, Math.min(100, Math.round(limit.usedPercent)));
  const remaining = Math.max(0, Math.min(100, Math.round(limit.remainingPercent)));
  const tone = rateLimitTone(used);
  const labelId = `otto-rate-limit-${limit.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const title = rateLimitDisplayLabel(limit, compact);
  const reset = formatResetTime(limit.resetsAt, now);

  return (
    <div
      className={
        compact
          ? "min-w-0 rounded-otto-control border border-otto-line-soft bg-otto-ink-deep px-2.5 py-2"
          : "min-w-0"
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <Text
          as="span"
          variant={compact ? "meta" : "status"}
          id={labelId}
          className={`min-w-0 truncate ${compact ? "font-medium text-otto-text-bright" : "text-otto-text-bright"}`}
        >
          {title}
        </Text>
        <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
          <Text
            as="span"
            variant={compact ? "caption" : "meta"}
            className={`font-medium ${tone.text}`}
          >
            {`${remaining}% left`}
          </Text>
          {!compact && (
            <Text as="span" variant="caption" className="text-otto-text-tertiary">
              {`${used}% used`}
            </Text>
          )}
        </div>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-otto-control"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuenow={remaining}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={`block h-full w-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-200 ${tone.bar}`}
          style={{ transform: `scaleX(${remaining / 100})` }}
        />
      </div>
      {reset && (
        <Text
          as="p"
          variant="caption"
          className="m-0 mt-1 truncate tabular-nums text-otto-text-tertiary"
          title={limit.resetsAt ?? undefined}
        >
          {reset}
        </Text>
      )}
    </div>
  );
}

export function ProviderRateLimits({
  rateLimits,
  compact = false,
  now = Date.now(),
}: {
  rateLimits: AgentRateLimit[];
  compact?: boolean;
  now?: number;
}) {
  if (rateLimits.length === 0) return null;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2.5 pt-2"}>
      <span className="flex items-center gap-1.5">
        <Icon name="gauge" size={13} className="shrink-0 text-otto-text-tertiary" />
        <Text
          as="span"
          variant={compact ? "meta" : "label"}
          className={compact ? "font-medium text-otto-text-secondary" : "text-otto-text-secondary"}
        >
          Usage limits
        </Text>
      </span>
      <div className={rateLimitListClass(compact, rateLimits.length)}>
        {rateLimits.map((limit) => (
          <RateLimitRow key={limit.id} limit={limit} compact={compact} now={now} />
        ))}
      </div>
    </div>
  );
}
