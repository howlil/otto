import type { AgentRateLimit } from "../../../platform/tauri";
import { Text } from "../../../shared/ui";
import { formatResetTime, rateLimitDisplayLabel, rateLimitTone } from "../model/rate-limits";

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
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <Text
          as="span"
          variant={compact ? "caption" : "status"}
          id={labelId}
          className={`min-w-0 truncate ${compact ? "text-otto-text-secondary" : "text-otto-text-bright"}`}
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
        className={`${compact ? "mt-1 h-1" : "mt-1.5 h-1.5"} overflow-hidden rounded-full bg-otto-control`}
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={`block h-full w-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-200 ${tone.bar}`}
          style={{ transform: `scaleX(${used / 100})` }}
        />
      </div>
      {reset && (
        <Text
          as="p"
          variant="caption"
          className="m-0 mt-1 tabular-nums text-otto-text-tertiary"
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
    <div className={compact ? "space-y-2" : "space-y-2.5 pt-2"}>
      <Text
        as="span"
        variant={compact ? "meta" : "label"}
        className="block text-otto-text-secondary"
      >
        Usage limits
      </Text>
      <div className={compact ? "space-y-2" : "space-y-2.5"}>
        {rateLimits.map((limit) => (
          <RateLimitRow key={limit.id} limit={limit} compact={compact} now={now} />
        ))}
      </div>
    </div>
  );
}
