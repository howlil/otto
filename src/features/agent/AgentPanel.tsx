import { useEffect, useState } from "react";
import { AgentSettings } from "./AgentSettings";
import { AgentHeader, type AgentHeaderView } from "./AgentHeader";
import { AgentTranscript } from "./AgentTranscript";
import { History } from "./History";
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
  const { snapshot, readiness, provider, setProvider, locked, busy, captureBusy, newSession } =
    agent;
  const [captureSettingsEntry, setCaptureSettingsEntry] = useState(false);
  const [captureActionError, setCaptureActionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const view: AgentHeaderView = settings ? "settings" : historyOpen ? "history" : "chat";

  useEffect(() => {
    if (settings) setHistoryOpen(false);
  }, [settings]);

  useEffect(() => {
    if (historyOpen) void agent.history.refresh();
  }, [historyOpen, agent.history.refresh]);

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
        view={view}
        provider={snapshot.threadId ? snapshot.provider : provider}
        model={agent.model}
        thinkingEffort={agent.thinkingEffort}
        status={snapshot.status}
        hasThread={snapshot.threadId !== null || snapshot.messages.length > 0}
        resetBusy={busy || captureBusy}
        capturePhase={snapshot.capture.phase}
        readiness={readiness.status}
        eventMotion={eventMotion}
        onBack={() => {
          if (settings) onSettingsBack();
          else setHistoryOpen(false);
        }}
        onSettings={() => {
          setCaptureSettingsEntry(false);
          onSettings();
        }}
        onHistory={() => setHistoryOpen(true)}
        onNewSession={() => void newSession()}
        onHome={onBack}
      />
      <TransitionContent
        transitionKey={`agent-${view}`}
        direction={view === "chat" ? "back" : "forward"}
        reducedMotion={reducedMotion}
        className="min-h-0 flex-1"
      >
        {view === "history" ? (
          <History
            history={agent.history}
            busy={busy || captureBusy}
            onDone={() => setHistoryOpen(false)}
            onMeasured={onMeasured}
          />
        ) : settings ? (
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
            onRetry={() => void agent.refreshProvider()}
            locked={locked}
            busy={busy || captureBusy}
            error={agent.error}
            onDone={onSettingsBack}
            onMeasured={onMeasured}
            reducedMotion={reducedMotion}
          />
        ) : (
          <AgentTranscript
            agent={agent}
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
