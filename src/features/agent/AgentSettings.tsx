import { useEffect } from "react";
import { Button, ChoiceGroup, StatusMessage, Text, TextField } from "../../shared/ui";
import type { CaptureShortcutModel } from "./view-model";
import type {
  AgentMode,
  AgentStatus,
  CaptureSource,
  ProviderReadiness,
} from "../../platform/tauri";
import { ModeSettings, ProjectSettings, ProviderSettings } from "./AgentSettingsSections";
import { agentStatusLabel } from "./status";

export function AgentSettings({
  readiness,
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
  const {
    source,
    selectSource,
    shortcut,
    setShortcut,
    captureMessage,
    savingCapture,
    available,
    saveShortcut,
  } = capture;
  useEffect(() => {
    if (!focusCaptureShortcut || !available) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("otto-capture-shortcut")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusCaptureShortcut, available]);

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
        <ProviderSettings readiness={readiness} providerStatus={providerStatus} onRetry={onRetry} />
        <ModeSettings mode={mode} locked={locked} setMode={setMode} />
        <ProjectSettings cwd={cwd} locked={locked} setCwd={setCwd} />
        <section className="border-b border-otto-raised-deep py-3">
          <Text
            as="label"
            variant="meta"
            className="block text-otto-muted-strong"
            htmlFor="otto-capture-shortcut"
          >
            Screen capture shortcut
          </Text>
          <div className="mt-2 flex items-center gap-2 rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2">
            <TextField
              id="otto-capture-shortcut"
              value={shortcut}
              onChange={(event) => setShortcut(event.target.value)}
              placeholder="Ctrl+Shift+O"
              disabled={!available || savingCapture}
              spellCheck={false}
              className="h-[34px] min-w-0 flex-1 bg-transparent text-otto-sm text-otto-knob outline-none"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!available || savingCapture}
              onClick={() => void saveShortcut()}
            >
              Apply
            </Button>
          </div>
          <Text as="p" variant="caption" className="mt-1.5 text-otto-text-tertiary">
            Use Ctrl with Shift or Alt and one letter. Capture is triggered only by the shortcut;
            image analysis requires a compatible provider.
          </Text>
          <div className="mt-3">
            <ChoiceGroup<CaptureSource>
              value={source}
              choices={[
                { value: "window", label: "Last window" },
                { value: "fullScreen", label: "Full desktop" },
              ]}
              onChange={(next) => void selectSource(next)}
              disabled={!available || savingCapture}
            />
          </div>
          <Text as="p" variant="caption" className="mt-2 text-otto-text-tertiary">
            {source === "fullScreen"
              ? "Full desktop may include Otto and other visible applications. Press the hotkey to capture."
              : "Last window captures the recent external application. Press the hotkey to capture."}
          </Text>
          {!available && (
            <StatusMessage tone="info" className="mt-2">
              Screen capture shortcuts can only be configured in Otto for Windows.
            </StatusMessage>
          )}
          {captureMessage && (
            <StatusMessage tone="info" className="mt-2">
              {captureMessage}
            </StatusMessage>
          )}
        </section>
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
