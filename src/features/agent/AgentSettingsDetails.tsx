import { Button, StatusMessage, Text } from "../../shared/ui";
import type { AgentStatus, ProviderReadiness } from "../../platform/tauri";
import { AgentCaptureSettings } from "./AgentCaptureSettings";
import type { AgentSettingsProps } from "./AgentSettings";
import type { AgentSettingsTab } from "./AgentSettingsNavigation";
import { ModeSettings, ProjectSettings, ProviderSettings } from "./AgentSettingsSections";
import { agentStatusLabel } from "./status";

const introductions: Record<AgentSettingsTab, string> = {
  provider: "Select your local CLI. Its capabilities determine the available actions.",
  mode: "The selected mode controls permissions for the entire conversation.",
  usage: "Local CLI runtime details are kept in settings, away from your conversation.",
  workspace: "The working directory belongs to a single provider session.",
  capture: "Screenshot analysis is native; target and image support must be verified.",
};
const headings: Record<AgentSettingsTab, string> = {
  provider: "Provider",
  mode: "Interaction mode",
  usage: "Model & usage",
  workspace: "Working project",
  capture: "Screen Capture",
};

function SettingsHeader({ tab }: { tab: AgentSettingsTab }) {
  return (
    <>
      <Text as="h2" variant="heading" className="mb-1">
        {headings[tab]}
      </Text>
      <Text as="p" variant="meta" className="mb-[15px] block leading-[1.5] text-otto-text-tertiary">
        {introductions[tab]}
      </Text>
    </>
  );
}

function ActiveRunNotice({ busy, approvalPending, runStatus, onDone }: {
  busy: boolean;
  approvalPending: boolean;
  runStatus: AgentStatus;
  onDone: () => void;
}) {
  if (!busy) return null;
  return (
    <StatusMessage
      tone={approvalPending ? "warn" : "info"}
      className="mb-2 text-otto-text-tertiary"
      action={{ label: approvalPending ? "Review" : "Return", onClick: onDone }}
    >
      {approvalPending
        ? "Approval is waiting in the Agent view."
        : `${agentStatusLabel(runStatus)} request is still active.`}
    </StatusMessage>
  );
}

function CaptureSettings({ readiness, capture, focusCaptureShortcut }: Pick<
  AgentSettingsProps,
  "readiness" | "capture" | "focusCaptureShortcut"
>) {
  return (
    <div className="space-y-2">
      {readiness.imageTransport && (
        <AgentCaptureSettings capture={capture} focusCaptureShortcut={focusCaptureShortcut} />
      )}
      {!readiness.imageTransport && (
        <StatusMessage tone="info">
          This provider cannot transport screenshots. Choose Codex or a vision-capable Pi model.
        </StatusMessage>
      )}
      {readiness.imageTransport && readiness.status === "ready" && !readiness.imageInput && (
        <StatusMessage tone="info">
          The selected model does not confirm image input. Choose a vision-capable model in your CLI
          and Retry before capturing.
        </StatusMessage>
      )}
    </div>
  );
}

function ModelUsageSettings() {
  return (
    <section aria-labelledby="otto-model-usage-title">
      <h2 id="otto-model-usage-title" className="sr-only">
        Model and context usage
      </h2>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 text-otto-sm">
        <dt className="text-otto-text-tertiary">Active model</dt>
        <dd>Not detected</dd>
        <dt className="text-otto-text-tertiary">Thinking effort</dt>
        <dd>Unavailable</dd>
        <dt className="text-otto-text-tertiary">Context used</dt>
        <dd>Unavailable</dd>
        <dt className="text-otto-text-tertiary">Context remaining</dt>
        <dd>Unavailable</dd>
      </dl>
      <Text as="p" variant="caption" className="mt-4 leading-[1.5] text-otto-text-tertiary">
        Native provider snapshots do not expose model, thinking effort, or token usage.
        Values remain unavailable until a provider confirms them. Context remaining is not
        an account token quota.
      </Text>
    </section>
  );
}

function SettingsFooter({ hasThread, busy, onNewSession, error }: Pick<
  AgentSettingsProps,
  "hasThread" | "busy" | "onNewSession" | "error"
>) {
  return (
    <>
      {hasThread && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <Text as="span" variant="status" className="text-otto-text-tertiary">
            New session unlocks the context.
          </Text>
          <Button variant="primary" size="sm" disabled={busy} onClick={onNewSession}>
            New Session
          </Button>
        </div>
      )}
      {error && (
        <StatusMessage tone="error" className="mt-3 text-otto-text-tertiary">
          {error}
        </StatusMessage>
      )}
    </>
  );
}

export function AgentSettingsDetails({
  tab,
  ...props
}: AgentSettingsProps & { tab: AgentSettingsTab }) {
  const providerStatus =
    props.readiness.status === "ready"
      ? "Ready"
      : props.readiness.status === "checking"
        ? "Checking"
        : "Setup required";
  return (
    <div className="min-h-0 min-w-0 overflow-y-auto px-[17px] pb-5 pt-[15px] [overscroll-behavior:contain] [scrollbar-width:none]">
      <SettingsHeader tab={tab} />
      <ActiveRunNotice {...props} />
      {tab === "provider" && (
        <ProviderSettings
          readiness={props.readiness}
          providerStatus={providerStatus}
          provider={props.provider}
          onSelect={props.setProvider}
          locked={props.locked}
          onRetry={props.onRetry}
        />
      )}
      {tab === "mode" && (
        <ModeSettings
          mode={props.mode}
          locked={props.locked || !props.readiness.agentSession}
          setMode={props.setMode}
        />
      )}
      {tab === "workspace" && (
        <ProjectSettings cwd={props.cwd} locked={props.locked} setCwd={props.setCwd} />
      )}
      {tab === "capture" && <CaptureSettings {...props} />}
      {tab === "usage" && <ModelUsageSettings />}
      <SettingsFooter {...props} />
    </div>
  );
}
