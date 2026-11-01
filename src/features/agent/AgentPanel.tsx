import { useEffect, useState } from "react";
import { AgentSettings } from "./AgentSettings";
import { AgentHeader } from "./AgentHeader";
import { AgentTranscript } from "./AgentTranscript";
import type { AgentPanelModel } from "./view-model";
import { TransitionContent } from "../../shared/ui";

type Props = {
  agent: AgentPanelModel;
  settings: boolean;
  onSettings: () => void;
  onSettingsBack: () => void;
  onBack: () => void;
  motionClass?: string;
  eventMotion?: string;
  onMeasured: (height: number) => void;
  reducedMotion: boolean;
};

export function AgentPanel({
  agent,
  settings,
  onSettings,
  onSettingsBack,
  onBack,
  motionClass = "",
  eventMotion,
  onMeasured,
  reducedMotion,
}: Props) {
  const {
    snapshot,
    readiness,
    cwd,
    setCwd,
    beginWorkspaceEdit,
    commitWorkspace,
    cancelWorkspaceEdit,
    mode,
    setMode,
    provider,
    setProvider,
    locked,
    busy,
    captureBusy,
    newSession,
  } = agent;
  const [denied, setDenied] = useState(false);
  const [captureSettingsEntry, setCaptureSettingsEntry] = useState(false);
  const [captureActionError, setCaptureActionError] = useState<string | null>(null);
  const approval = snapshot.approval;
  const approvalPending = snapshot.status === "approvalRequired" && Boolean(approval);
  const project =
    (snapshot.threadId ? snapshot.cwd : cwd || snapshot.cwd).split(/[\\/]/).filter(Boolean).pop() ||
    "Workspace";

  useEffect(() => {
    if (snapshot.status === "starting") setDenied(false);
  }, [snapshot.status]);

  useEffect(() => {
    if (settings || !captureSettingsEntry) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("otto-capture-setup")?.focus({ preventScroll: true });
      setCaptureSettingsEntry(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [settings, captureSettingsEntry]);

  return (
    <section
      className={`flex h-full min-h-0 flex-col ${motionClass} ${eventMotion === "otto-failed" ? "motion-safe:animate-otto-shake" : ""}`}
      data-surface="agent"
      data-status={snapshot.status}
      data-capture-phase={snapshot.capture.phase}
    >
      <AgentHeader
        settings={settings}
        project={project}
        mode={snapshot.threadId ? snapshot.mode : mode}
        provider={snapshot.threadId ? snapshot.provider : provider}
        status={snapshot.status}
        hasThread={snapshot.threadId !== null}
        resetBusy={busy || captureBusy}
        capturePhase={snapshot.capture.phase}
        readiness={readiness.status}
        activity={Boolean(snapshot.activity)}
        eventMotion={eventMotion}
        onSettings={() => {
          setCaptureSettingsEntry(false);
          onSettings();
        }}
        onSettingsBack={onSettingsBack}
        onNewSession={() => void newSession()}
        onHome={onBack}
      />
      <TransitionContent
        transitionKey={settings ? "agent-settings" : "agent-transcript"}
        direction={settings ? "forward" : "back"}
        reducedMotion={reducedMotion}
        className="min-h-0 flex-1"
      >
        {settings ? (
          <AgentSettings
            readiness={readiness}
            snapshot={snapshot}
            provider={provider}
            setProvider={setProvider}
            model={agent.model}
            setModel={agent.setModel}
            thinkingEffort={agent.thinkingEffort}
            setThinkingEffort={agent.setThinkingEffort}
            capture={agent.capture}
            focusCaptureShortcut={captureSettingsEntry}
            runStatus={snapshot.status}
            approvalPending={approvalPending}
            onRetry={() => void agent.refreshProvider()}
            mode={mode}
            setMode={setMode}
            locked={locked}
            cwd={cwd}
            setCwd={setCwd}
            beginWorkspaceEdit={beginWorkspaceEdit}
            commitWorkspace={commitWorkspace}
            cancelWorkspaceEdit={cancelWorkspaceEdit}
            busy={busy || captureBusy}
            error={agent.error}
            onDone={onSettingsBack}
            onMeasured={onMeasured}
            reducedMotion={reducedMotion}
          />
        ) : (
          <AgentTranscript
            agent={agent}
            denied={denied}
            approvalPending={approvalPending}
            onDenied={() => setDenied(true)}
            captureActionError={captureActionError}
            onMeasured={onMeasured}
            onCapture={() => {
              setCaptureActionError(null);
              void agent
                .captureNow()
                .catch((error: unknown) =>
                  setCaptureActionError(
                    typeof error === "string"
                      ? error
                      : error instanceof Error
                        ? error.message
                        : "Screen capture is unavailable.",
                  ),
                );
            }}
            onConfigureCapture={() => {
              setCaptureSettingsEntry(true);
              onSettings();
            }}
          />
        )}
      </TransitionContent>
    </section>
  );
}
