import {
  ActiveIndicatorGroup,
  Button,
  SettingBlock,
  StatusMessage,
  Text,
} from "../../../shared/ui";
import type {
  AgentProvider,
  AgentProviderDescriptor,
  ProviderReadiness,
} from "../../../platform/tauri";
import { MissingProviders } from "./MissingProviders";
import { ProviderChoice } from "./ProviderChoice";

function readinessMessage(readiness: ProviderReadiness): string {
  return [readiness.message, readiness.recovery].filter(Boolean).join(" ");
}

type ProviderSettingsProps = {
  readiness: ProviderReadiness;
  providers: AgentProviderDescriptor[];
  providerStatus: string;
  onRetry: () => void;
  onRefreshPath?: () => void;
  provider: AgentProvider;
  onSelect: (provider: AgentProvider) => void;
  locked: boolean;
};

function ProviderHeaderActions({
  status,
  locked,
  onRefreshPath,
}: {
  status: ProviderReadiness["status"];
  locked: boolean;
  onRefreshPath: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <ReadinessBadge status={status} />
      <Button
        variant="quiet"
        size="link"
        className="text-otto-text-tertiary"
        disabled={locked}
        onClick={onRefreshPath}
      >
        Check again
      </Button>
    </div>
  );
}

function ReadinessBadge({ status }: { status: ProviderReadiness["status"] }) {
  if (status !== "ready" && status !== "checking") return null;
  return (
    <span className="flex items-center gap-1.5 text-otto-text-secondary" role="status">
      <span
        className={`size-1.5 rounded-full ${status === "ready" ? "bg-otto-ok" : "bg-otto-muted"}`}
        aria-hidden="true"
      />
      <Text as="span" variant="status">
        {status === "ready" ? "Ready" : "Checking…"}
      </Text>
    </span>
  );
}

function ReadinessProblem({
  readiness,
  providerStatus,
  onRetry,
}: Pick<ProviderSettingsProps, "readiness" | "providerStatus" | "onRetry">) {
  if (readiness.status === "ready" || readiness.status === "checking") return null;
  return (
    <StatusMessage
      tone="warn"
      className="mt-2 text-otto-text-tertiary"
      title={providerStatus}
      action={{ label: "Retry", onClick: onRetry }}
    >
      {readinessMessage(readiness)}
    </StatusMessage>
  );
}

export function ProviderSettings({
  readiness,
  providers,
  providerStatus,
  onRetry,
  onRefreshPath,
  provider,
  onSelect,
  locked,
}: ProviderSettingsProps) {
  const available = providers.filter((candidate) => candidate.installed);
  const missing = providers.filter((candidate) => !candidate.installed);
  return (
    <SettingBlock
      title="AI Engine"
      help="The AI app on this PC that writes Otto's answers"
      action={
        <ProviderHeaderActions
          status={readiness.status}
          locked={locked}
          onRefreshPath={onRefreshPath ?? onRetry}
        />
      }
    >
      <fieldset className="border-0 p-0">
        {providers.length > 0 ? (
          <ActiveIndicatorGroup
            activeKey={provider}
            className="grid min-w-0 grid-cols-2 gap-2"
            indicatorClassName="rounded-otto-card border border-otto-line-focused bg-otto-selected"
          >
            {available.map(({ id, displayName, command }) => (
              <ProviderChoice
                key={id}
                name={displayName}
                command={command}
                installed
                status={provider === id ? providerStatus : "Select"}
                selected={provider === id}
                locked={locked}
                onSelect={!locked ? () => onSelect(id) : undefined}
              />
            ))}
          </ActiveIndicatorGroup>
        ) : (
          <StatusMessage tone="info">
            Provider detection is unavailable here. Open Otto on Windows and retry.
          </StatusMessage>
        )}
      </fieldset>
      <ReadinessProblem readiness={readiness} providerStatus={providerStatus} onRetry={onRetry} />
      <MissingProviders providers={missing} onRetry={onRetry} />
    </SettingBlock>
  );
}
