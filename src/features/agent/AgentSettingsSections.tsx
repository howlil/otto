import { StatusMessage, Text } from "../../shared/ui";
import type { AgentProvider, ProviderReadiness } from "../../platform/tauri";
import { ProviderChoice, type ProviderName } from "./ProviderChoice";

const providers: ReadonlyArray<{
  name: ProviderName;
  command: AgentProvider;
}> = [
  { name: "Codex", command: "codex" },
  { name: "Agy", command: "agy" },
  { name: "Pi", command: "pi" },
];

export function ProviderSettings({
  readiness,
  providerStatus,
  onRetry,
  provider,
  onSelect,
  locked,
}: {
  readiness: ProviderReadiness;
  providerStatus: string;
  onRetry: () => void;
  provider: AgentProvider;
  onSelect: (provider: AgentProvider) => void;
  locked: boolean;
}) {
  return (
    <section className="border-b border-otto-raised-deep pb-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Text
          as="span"
          variant="label"
          className="text-otto-text-secondary"
          id="otto-provider-label"
        >
          Choose your agent
        </Text>
        <Text as="span" variant="caption" className="text-otto-text-tertiary">
          Local CLI
        </Text>
      </div>
      <fieldset
        className="grid min-w-0 grid-cols-3 gap-2 border-0 p-0"
        aria-labelledby="otto-provider-label"
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
      </fieldset>
      <StatusMessage
        tone={
          readiness.status === "ready"
            ? "success"
            : readiness.status === "checking"
              ? "info"
              : "warn"
        }
        className="mt-[10px] rounded-otto-control border border-otto-line-mid bg-otto-field-deep p-[10px] text-otto-text-tertiary [&>div]:min-w-0 [&>div]:flex-1 [&>div>p]:mt-0.5 [&>div>p]:m-0"
        title={providerStatus}
        action={
          readiness.status !== "ready"
            ? { label: "Retry", onClick: onRetry, disabled: readiness.status === "checking" }
            : undefined
        }
      >
        {readiness.message} {readiness.recovery}
      </StatusMessage>
    </section>
  );
}
