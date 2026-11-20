import type { AgentModelOption, ProviderReadiness } from "../../../platform/tauri";

const effortLabels: Record<string, string> = {
  off: "Off",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

const effortHints: Record<string, string> = {
  off: "No extra reasoning step.",
  none: "No extra reasoning step.",
  minimal: "Fastest answers with very little reasoning.",
  low: "Quick answers for simple requests.",
  medium: "Balanced speed and depth.",
  high: "Slower, deeper reasoning for hard problems.",
  xhigh: "Slowest and most thorough.",
  max: "Slowest and most thorough.",
  ultra: "Slowest and most thorough.",
};

export function effortHint(value: string): string {
  return (
    effortHints[value.toLowerCase()] ?? "Higher levels think longer: slower, but more thorough."
  );
}

export function formatTokens(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "0"
    : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      );
}

export function formatEffortLabel(value: string): string {
  const mapped = effortLabels[value.toLowerCase()];
  if (mapped) return mapped;
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function modelMetadata(
  option: AgentModelOption | undefined,
  observedWindow: number | null | undefined,
): string | null {
  const parts: string[] = [];
  const contextWindow = option?.contextWindow ?? observedWindow ?? null;
  if (contextWindow != null && contextWindow > 0) {
    parts.push(`${formatTokens(contextWindow)} context`);
  }
  if (option?.imageInput) {
    parts.push("Vision");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function resolveThinkingEfforts(
  readiness: ProviderReadiness,
  selectedOption: AgentModelOption | undefined,
): string[] {
  const raw = selectedOption
    ? selectedOption.thinkingEfforts
    : readiness.models.length === 0
      ? readiness.thinkingEfforts
      : [];
  return raw.length === 1 && raw[0] === "off" ? [] : raw;
}

export function resolveSelectedEffort(
  readiness: ProviderReadiness,
  selectedOption: AgentModelOption | undefined,
  thinkingEffort: string | null,
  efforts: string[],
): string {
  if (efforts.length === 0) return "";
  if (thinkingEffort && efforts.includes(thinkingEffort)) return thinkingEffort;
  if (
    (!selectedOption || selectedOption.id === readiness.model) &&
    readiness.thinkingEffort &&
    efforts.includes(readiness.thinkingEffort)
  ) {
    return readiness.thinkingEffort;
  }
  if (
    selectedOption?.defaultThinkingEffort &&
    efforts.includes(selectedOption.defaultThinkingEffort)
  ) {
    return selectedOption.defaultThinkingEffort;
  }
  return efforts[0] ?? "";
}
