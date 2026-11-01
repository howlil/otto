import type { Ref } from "react";
import { StatusMessage, Text, TransitionContent } from "../../shared/ui";
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
  scrollRef,
  ...props
}: AgentSettingsProps & { tab: AgentSettingsTab; scrollRef: Ref<HTMLDivElement> }) {
  const providerStatus =
    props.readiness.status === "ready"
      ? "Ready"
      : props.readiness.status === "checking"
        ? "Checking"
        : "Setup required";
  return (
    <div
      ref={scrollRef}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto [overscroll-behavior:contain] [scrollbar-width:none]"
    >
      <div className="min-w-0 px-[17px] pb-5 pt-[15px]">
        <SettingsHeader tab={tab} />
        <ActiveRunNotice {...props} />
        <TransitionContent transitionKey={tab} kind="tab" reducedMotion={props.reducedMotion}>
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
                <ProjectSettings
                  cwd={props.cwd}
                  locked={props.locked}
                  setCwd={props.setCwd}
                  onBeginEdit={props.beginWorkspaceEdit}
                  onCommit={props.commitWorkspace}
                  onCancel={props.cancelWorkspaceEdit}
                />
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
        </TransitionContent>
        <SettingsFooter error={props.error} />
      </div>
    </div>
  );
}
