import { ActiveIndicatorGroup, StatusMessage, Text } from "../../shared/ui";
import type { AgentProvider, ProviderReadiness } from "../../platform/tauri";
import { ProviderChoice, type ProviderName } from "./ProviderChoice";

const providers: ReadonlyArray<{
  name: ProviderName;
  command: AgentProvider;
}> = [
  { name: "Codex", command: "codex" },
  { name: "Agy", command: "agy" },
  { name: "Pi", command: "pi" },
  { name: "OpenCode", command: "opencode" },
];

function readinessMessage(readiness: ProviderReadiness): string {
  if (readiness.status === "ready") return "Ready";
  if (readiness.status === "checking") return "Checking…";
  return [readiness.message, readiness.recovery].filter(Boolean).join(" ");
}

type ProviderSettingsProps = {
  readiness: ProviderReadiness;
  providerStatus: string;
  onRetry: () => void;
  provider: AgentProvider;
  onSelect: (provider: AgentProvider) => void;
  locked: boolean;
};

function ProviderReadinessStatus({
  readiness,
  providerStatus,
  onRetry,
}: Pick<ProviderSettingsProps, "readiness" | "providerStatus" | "onRetry">) {
  if (readiness.status === "ready") {
    return (
      <div className="mt-2 flex items-center gap-2 text-otto-text-secondary" role="status">
        <span className="size-1.5 rounded-full bg-otto-ok" aria-hidden="true" />
        <Text as="span" variant="status">
          Ready
        </Text>
      </div>
    );
  }

  return (
    <StatusMessage
      tone={readiness.status === "checking" ? "info" : "warn"}
      className="mt-2 rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-3 py-2 text-otto-text-tertiary [&>div]:min-w-0 [&>div]:flex-1 [&>div>p]:m-0 [&>div>p]:mt-0.5"
      title={readiness.status === "checking" ? undefined : providerStatus}
      action={readiness.status !== "checking" ? { label: "Retry", onClick: onRetry } : undefined}
    >
      {readinessMessage(readiness)}
    </StatusMessage>
  );
}

export function ProviderSettings({
  readiness,
  providerStatus,
  onRetry,
  provider,
  onSelect,
  locked,
}: ProviderSettingsProps) {
  return (
    <section className="border-b border-otto-raised-deep pb-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Text
          as="span"
          variant="label"
          className="text-otto-text-secondary"
          id="otto-provider-label"
        >
          Provider
        </Text>
      </div>
      <fieldset className="border-0 p-0" aria-labelledby="otto-provider-label">
        <ActiveIndicatorGroup
          activeKey={provider}
          className="grid min-w-0 grid-cols-4 gap-2"
          indicatorClassName="rounded-otto-card border border-otto-line-focused bg-otto-selected"
        >
          {providers.map(({ name, command }) => (
            <ProviderChoice
              key={name}
              name={name}
              command={command}
              status={provider === command ? providerStatus : "Select"}
              selected={provider === command}
              locked={locked}
              onSelect={!locked ? () => onSelect(command) : undefined}
            />
          ))}
        </ActiveIndicatorGroup>
      </fieldset>
      <ProviderReadinessStatus
        readiness={readiness}
        providerStatus={providerStatus}
        onRetry={onRetry}
      />
    </section>
  );
}
