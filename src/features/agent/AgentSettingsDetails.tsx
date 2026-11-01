import { StatusMessage, Text } from "../../shared/ui";
import type { AgentStatus } from "../../platform/tauri";
import { AgentCaptureSettings } from "./AgentCaptureSettings";
import type { AgentSettingsProps } from "./AgentSettings";
import type { AgentSettingsTab } from "./AgentSettingsNavigation";
import { ModelUsageSettings } from "./ModelUsageSettings";
import { ModeSettings, ProjectSettings, ProviderSettings } from "./AgentSettingsSections";
import { agentStatusLabel } from "./status";

const headings: Record<AgentSettingsTab, string> = {
  setup: "Agent setup",
  capture: "Screen capture",
};

function SettingsHeader({ tab }: { tab: AgentSettingsTab }) {
  return (
    <div className="mb-3">
      <Text as="h2" variant="heading">
        {headings[tab]}
      </Text>
    </div>
  );
}

function ActiveRunNotice({
  busy,
  approvalPending,
  runStatus,
  onDone,
}: {
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

function CaptureSettings({
  readiness,
  capture,
  focusCaptureShortcut,
}: Pick<AgentSettingsProps, "readiness" | "capture" | "focusCaptureShortcut">) {
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

function SettingsFooter({ error }: Pick<AgentSettingsProps, "error">) {
  return (
    <>
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
    <div className="min-w-0 overflow-y-auto px-[17px] pb-5 pt-[15px] [overscroll-behavior:contain] [scrollbar-width:none]">
      <SettingsHeader tab={tab} />
      <ActiveRunNotice {...props} />
      {tab === "setup" && (
        <div className="space-y-3">
          <ProviderSettings
            readiness={props.readiness}
            providerStatus={providerStatus}
            provider={props.provider}
            onSelect={props.setProvider}
            locked={props.locked}
            onRetry={props.onRetry}
          />
          <div className="grid grid-cols-1 items-start gap-3 min-[360px]:grid-cols-2">
            <ModeSettings
              mode={props.mode}
              locked={props.locked}
              agentSessionAvailable={props.readiness.agentSession}
              setMode={props.setMode}
            />
            <ProjectSettings cwd={props.cwd} locked={props.locked} setCwd={props.setCwd} />
          </div>
          <ModelUsageSettings
            readiness={props.readiness}
            snapshot={props.snapshot}
            model={props.model}
            setModel={props.setModel}
            thinkingEffort={props.thinkingEffort}
            setThinkingEffort={props.setThinkingEffort}
            busy={props.busy}
          />
        </div>
      )}
      {tab === "capture" && <CaptureSettings {...props} />}
      <SettingsFooter error={props.error} />
    </div>
  );
}
