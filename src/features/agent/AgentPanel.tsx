import { useEffect, useState } from "react";
import { AgentSettings } from "./AgentSettings";
import { AgentHeader } from "./AgentHeader";
import { AgentTranscript } from "./AgentTranscript";
import type { AgentPanelModel } from "./view-model";
import { captureAgentNow } from "../../platform/tauri";

type Props = {
  agent: AgentPanelModel;
  settings: boolean;
  onSettings: () => void;
  onSettingsBack: () => void;
  onBack: () => void;
  motionClass?: string;
  eventMotion?: string;
};

export function AgentPanel({
  agent,
  settings,
  onSettings,
  onSettingsBack,
  onBack,
  motionClass = "",
  eventMotion,
}: Props) {
  const {
    snapshot,
    readiness,
    cwd,
    setCwd,
    mode,
    setMode,
    provider,
    setProvider,
    locked,
    busy,
    newSession,
  } = agent;
  const [denied, setDenied] = useState(false);
  const [captureSettingsEntry, setCaptureSettingsEntry] = useState(false);
  const [captureActionError, setCaptureActionError] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
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
    >
      <AgentHeader
        settings={settings}
        project={project}
        mode={snapshot.threadId ? snapshot.mode : mode}
        provider={snapshot.threadId ? snapshot.provider : provider}
        status={snapshot.status}
        readiness={readiness.status}
        activity={Boolean(snapshot.activity)}
        eventMotion={eventMotion}
        actionsOpen={actionsOpen}
        onActions={() => setActionsOpen((open) => !open)}
        onSettings={() => {
          setActionsOpen(false);
          setCaptureSettingsEntry(false);
          onSettings();
        }}
        onSettingsBack={onSettingsBack}
        onHome={onBack}
      />
      {settings ? (
        <AgentSettings
          readiness={readiness}
          provider={provider}
          setProvider={setProvider}
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
          hasThread={snapshot.threadId !== null}
          busy={busy}
          error={agent.error}
          onNewSession={() => void newSession()}
          onDone={onSettingsBack}
        />
      ) : (
        <AgentTranscript
          agent={agent}
          denied={denied}
          approvalPending={approvalPending}
          onDenied={() => setDenied(true)}
          captureActionError={captureActionError}
          actionsOpen={actionsOpen}
          setActionsOpen={setActionsOpen}
          onCapture={() => {
            setCaptureActionError(null);
            void captureAgentNow().catch((error: unknown) =>
              setCaptureActionError(
                error instanceof Error ? error.message : "Screen capture is unavailable.",
              ),
            );
          }}
          onConfigureCapture={() => {
            setCaptureSettingsEntry(true);
            onSettings();
          }}
        />
      )}
    </section>
  );
}
