import { useEffect, useState } from "react";
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
  onDone: () => void;
  capture: CaptureShortcutModel;
  focusCaptureShortcut: boolean;
}) {
  const [tab, setTab] = useState<"provider" | "mode" | "workspace" | "capture" | "usage">("provider");
  useEffect(() => {
    if (focusCaptureShortcut) setTab("capture");
  }, [focusCaptureShortcut]);
  const providerStatus =
    readiness.status === "ready"
      ? "Ready"
      : readiness.status === "checking"
        ? "Checking"
        : "Setup required";
  const tabs = [
    { id: "provider", label: "Provider" },
    { id: "mode", label: "Mode" },
    { id: "workspace", label: "Workspace" },
    { id: "capture", label: "Screen Capture" },
    { id: "usage", label: "Model & usage" },
  ] as const;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[118px_minmax(0,1fr)]">
        <nav
          aria-labelledby="otto-agent-settings-sections"
          className="flex flex-col gap-1 border-r border-otto-line-soft bg-otto-nav-bg px-2 py-[13px]"
        >
          <span id="otto-agent-settings-sections" className="sr-only">
            Agent settings sections
          </span>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => setTab(item.id)}
              className={`min-h-[35px] rounded-otto-control px-2.5 text-left text-otto-sm transition-colors hover:bg-otto-control-deep hover:text-otto-text ${tab === item.id ? "bg-otto-control-deep text-otto-text" : "text-otto-text-tertiary"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 overflow-y-auto px-[17px] pb-4 pt-[13px] [overscroll-behavior:contain] [scrollbar-width:none]">
          <Text as="h2" variant="heading" className="mb-1">
            {tabs.find((item) => item.id === tab)?.label}
          </Text>
          {busy && (
            <StatusMessage
              tone={approvalPending ? "warn" : "info"}
              className="mb-2 text-otto-text-tertiary"
              action={{ label: approvalPending ? "Review" : "Return", onClick: onDone }}
            >
              {approvalPending
                ? "Approval is waiting in the Agent view."
                : `${agentStatusLabel(runStatus)} request is still active.`}
            </StatusMessage>
          )}
          {tab === "provider" && (
            <ProviderSettings
              readiness={readiness}
              providerStatus={providerStatus}
              provider={provider}
              onSelect={setProvider}
              locked={locked}
              onRetry={onRetry}
            />
          )}
          {tab === "mode" && (
            <ModeSettings
              mode={mode}
              locked={locked || !readiness.agentSession}
              setMode={setMode}
            />
          )}
          {tab === "workspace" && <ProjectSettings cwd={cwd} locked={locked} setCwd={setCwd} />}
          {tab === "capture" && (
            <div className="space-y-2">
              {readiness.imageTransport && (
                <AgentCaptureSettings
                  capture={capture}
                  focusCaptureShortcut={focusCaptureShortcut}
                />
              )}
              {!readiness.imageTransport && (
                <StatusMessage tone="info">
                  This provider cannot transport screenshots. Choose Codex or a vision-capable Pi
                  model.
                </StatusMessage>
              )}
              {readiness.imageTransport &&
                readiness.status === "ready" &&
                !readiness.imageInput && (
                  <StatusMessage tone="info">
                    The selected model does not confirm image input. Choose a vision-capable model
                    in your CLI and Retry before capturing.
                  </StatusMessage>
                )}
            </div>
          )}
          {tab === "usage" && (
            <section aria-label="Model and context usage">
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
          )}
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
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t border-otto-line-soft px-4 py-2">
        <Button variant="primary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
