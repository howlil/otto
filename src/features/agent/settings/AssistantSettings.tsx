import { StatusMessage } from "../../../shared/ui";
import type { AgentPanelModel } from "../model/view-model";
import { agentStatusLabel } from "../model/status";
import { ModelUsageSettings } from "./ModelUsageSettings";
import { ProfileSettings } from "./ProfileSettings";
import { ProviderSettings } from "./ProviderSettings";

export function AssistantSettings({
  agent,
  onStartOnboarding,
}: {
  agent: AgentPanelModel;
  onStartOnboarding?: () => void;
}) {
  const { readiness, snapshot } = agent;
  const working = agent.busy || agent.captureBusy;
  const providerStatus =
    readiness.status === "ready"
      ? "Ready"
      : readiness.status === "checking"
        ? "Checking"
        : "Setup required";
  return (
    <div className="space-y-4">
      {working && (
        <StatusMessage tone="info" className="text-otto-text-tertiary">
          {`${agentStatusLabel(snapshot.status)} request is still active. These unlock when it finishes.`}
        </StatusMessage>
      )}
      <ProviderSettings
        readiness={readiness}
        providers={agent.providers}
        providerStatus={providerStatus}
        provider={agent.provider}
        onSelect={agent.setProvider}
        locked={agent.locked}
        onRetry={() => void agent.refreshProvider()}
        onRefreshPath={() => void (agent.refreshPath ?? agent.refreshProvider)()}
      />
      {snapshot.messages.length > 0 && snapshot.threadId === null && (
        <StatusMessage tone="info">
          History stays in Otto. The next engine receives a bounded text transcript, not the
          original session.
        </StatusMessage>
      )}
      <ModelUsageSettings
        provider={agent.provider}
        readiness={readiness}
        refreshing={agent.refreshing}
        pinnedModels={agent.pinnedModels}
        onTogglePinModel={agent.togglePinnedModel}
        snapshot={snapshot}
        model={agent.model}
        setModel={agent.setModel}
        thinkingEffort={agent.thinkingEffort}
        setThinkingEffort={agent.setThinkingEffort}
        busy={working}
        onRetry={() => void agent.refreshProvider()}
      />
      <ProfileSettings
        profile={agent.profile}
        onChange={agent.setProfile}
        onClear={agent.clearProfile}
        onStartOnboarding={onStartOnboarding}
      />
      {agent.error && (
        <StatusMessage tone="error" className="text-otto-text-tertiary">
          {agent.error}
        </StatusMessage>
      )}
    </div>
  );
}
