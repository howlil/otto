import type { Ref } from "react";
import { StatusMessage, Text, TransitionContent } from "../../shared/ui";
import type { AgentStatus } from "../../platform/tauri";
import { AgentCaptureSettings } from "./AgentCaptureSettings";
import type { AgentSettingsProps } from "./AgentSettings";
import type { AgentSettingsTab } from "./AgentSettingsNavigation";
import { ModelUsageSettings } from "./ModelUsageSettings";
import { ProviderSettings } from "./AgentSettingsSections";
import { agentStatusLabel } from "./status";

const headings: Record<AgentSettingsTab, string> = {
  assistant: "Assistant",
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
  runStatus,
  onDone,
}: {
  busy: boolean;
  runStatus: AgentStatus;
  onDone: () => void;
}) {
  if (!busy) return null;
  return (
    <StatusMessage
      tone="info"
      className="mb-2 text-otto-text-tertiary"
      action={{ label: "Return", onClick: onDone }}
    >
      {`${agentStatusLabel(runStatus)} request is still active.`}
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
          Screenshots are not supported by this provider. Choose Codex or a vision-capable Pi model.
        </StatusMessage>
      )}
      {readiness.imageTransport && readiness.status === "ready" && !readiness.imageInput && (
        <StatusMessage tone="info">
          This model does not confirm image input. Choose a vision-capable model, then Retry.
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
      className="otto-scrollbar-hidden min-h-0 min-w-0 flex-1 overflow-y-auto [overscroll-behavior:contain]"
    >
      <div className="min-w-0 px-4 pb-4 pt-4">
        <SettingsHeader tab={tab} />
        <ActiveRunNotice {...props} />
        <TransitionContent transitionKey={tab} kind="tab" reducedMotion={props.reducedMotion}>
          {tab === "assistant" && (
            <div className="space-y-3">
              <ProviderSettings
                readiness={props.readiness}
                providerStatus={providerStatus}
                provider={props.provider}
                onSelect={props.setProvider}
                locked={props.locked}
                onRetry={props.onRetry}
              />
              {props.snapshot.messages.length > 0 && props.snapshot.threadId === null && (
                <StatusMessage tone="info">
                  History stays in Otto. The next provider receives a bounded text transcript, not
                  the original session.
                </StatusMessage>
              )}
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
