import { Button, StatusMessage, Text } from "../../shared/ui";
import type { CaptureShortcutModel } from "./view-model";
import type {
  AgentMode,
  AgentProvider,
  AgentStatus,
  ProviderReadiness,
} from "../../platform/tauri";
import { ModeSettings, ProjectSettings, ProviderSettings } from "./AgentSettingsSections";
import { AgentCaptureSettings } from "./AgentCaptureSettings";
import { agentStatusLabel } from "./status";

export function AgentSettings({
  readiness,
  provider,
  setProvider,
  runStatus,
  approvalPending,
  onRetry,
  mode,
  setMode,
  locked,
  cwd,
  setCwd,
  hasThread,
  busy,
  error,
  onNewSession,
  onBack,
  onDone,
  capture,
  focusCaptureShortcut,
}: {
  readiness: ProviderReadiness;
  provider: AgentProvider;
  setProvider: (provider: AgentProvider) => void;
  runStatus: AgentStatus;
  approvalPending: boolean;
  onRetry: () => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  locked: boolean;
  cwd: string;
  setCwd: (cwd: string) => void;
  hasThread: boolean;
  busy: boolean;
  error: string | null;
  onNewSession: () => void;
  onBack: () => void;
  onDone: () => void;
  capture: CaptureShortcutModel;
  focusCaptureShortcut: boolean;
}) {
  const providerStatus =
    readiness.status === "ready"
      ? "Ready"
      : readiness.status === "checking"
        ? "Checking"
        : "Setup required";
  return (
    <section className="flex min-h-0 flex-1 flex-col px-[18px] pb-[15px] pt-px">
      <div className="min-h-0 flex-1 overflow-y-auto px-px pb-1 [scrollbar-color:var(--color-otto-scrollbar-track)_transparent] [scrollbar-width:thin]">
        {busy && (
          <StatusMessage
            tone={approvalPending ? "warn" : "info"}
            className="mt-[10px] text-otto-text-tertiary [&>div]:min-w-0 [&>div]:flex-1 [&>div>p]:mt-0.5 [&>div>p]:m-0"
            action={{
              label: approvalPending ? "Review" : "Return",
              onClick: onDone,
            }}
          >
            {approvalPending
              ? "Approval is waiting in the Agent view."
              : `${agentStatusLabel(runStatus)} request is still active.`}
          </StatusMessage>
        )}
        <ProviderSettings
          readiness={readiness}
          providerStatus={providerStatus}
          provider={provider}
          onSelect={setProvider}
          locked={locked}
          onRetry={onRetry}
        />
        <ModeSettings mode={mode} locked={locked || !readiness.agentSession} setMode={setMode} />
        <ProjectSettings cwd={cwd} locked={locked} setCwd={setCwd} />
        {readiness.imageTransport ? (
          <>
            <AgentCaptureSettings capture={capture} focusCaptureShortcut={focusCaptureShortcut} />
            {readiness.status === "ready" && !readiness.imageInput && (
              <StatusMessage tone="info" className="mt-2">
                The selected model does not confirm image input. Choose a vision-capable model in
                your CLI and Retry before capturing.
              </StatusMessage>
            )}
          </>
        ) : (
          <StatusMessage tone="info" className="mt-2">
            This provider cannot transport screenshots. Select an image-capable provider for
            screenshots.
          </StatusMessage>
        )}
        {hasThread && (
          <div className="mt-px flex items-center justify-between gap-3 pt-[10px]">
            <Text as="span" variant="status" className="m-0 text-otto-text-tertiary">
              New session unlocks the context.
            </Text>
            <Button variant="primary" size="sm" disabled={busy} onClick={onNewSession}>
              New Session
            </Button>
          </div>
        )}

        {error && (
          <StatusMessage tone="error" className="mt-[10px] text-otto-text-tertiary">
            {error}
          </StatusMessage>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-[10px] pt-3">
        <Button variant="quiet" size="link" onClick={onBack}>
          Home
        </Button>
        <Button variant="primary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
