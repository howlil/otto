import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AgentHeader, type AgentHeaderView } from "./AgentHeader";
import { AgentPopoverFitProvider, usePanelMeasuredHeight } from "./popover-fit";
import { AgentTranscript } from "../transcript/AgentTranscript";
import { History } from "../history/History";
import { resolveRateLimits } from "../model/rate-limits";
import type { AgentPanelModel } from "../model/view-model";
import type { CaptureSource } from "../../../platform/tauri";
import { TransitionContent } from "../../../shared/ui";

type Props = {
  agent: AgentPanelModel;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
  onSettings: () => void;
  onConfigureCapture: () => void;
  eventMotion?: string;
  onMeasured: (height: number) => void;
  reducedMotion: boolean;
  compactCircle?: boolean;
  compactStyleLocked?: boolean;
  onToggleCompactStyle?: () => void;
  voiceControl?: ReactNode;
  speakingMessageId?: string | null;
  onToggleSpeak?: (messageId: string, text: string) => void;
};

function toCaptureError(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
}

function usePanelCaptureHandlers(agent: AgentPanelModel) {
  const [captureActionError, setCaptureActionError] = useState<string | null>(null);

  const onCapture = () => {
    setCaptureActionError(null);
    void agent
      .captureNow()
      .catch((err: unknown) =>
        setCaptureActionError(toCaptureError(err, "Screen capture is unavailable.")),
      );
  };

  const onCaptureSource = (nextSource: Exclude<CaptureSource, "selectedText">) => {
    setCaptureActionError(null);
    void agent.capture?.selectSource?.(nextSource);
    void agent
      .captureNow(nextSource)
      .catch((err: unknown) =>
        setCaptureActionError(toCaptureError(err, "Screen capture is unavailable.")),
      );
  };

  const onStageImage = (file: File) => {
    setCaptureActionError(null);
    if (!agent.readiness.imageTransport) {
      setCaptureActionError(
        "The selected AI engine only accepts text. Switch to an image-capable engine or use Selected text capture.",
      );
      return;
    }
    void agent
      .stageImage?.(file, file.name ? `Pasted image · ${file.name}` : "Pasted image")
      .catch((err: unknown) =>
        setCaptureActionError(toCaptureError(err, "Could not attach image.")),
      );
  };

  return { captureActionError, onCapture, onCaptureSource, onStageImage };
}

export function AgentPanel({
  agent,
  settingsButtonRef,
  onSettings,
  onConfigureCapture,
  eventMotion,
  onMeasured,
  reducedMotion,
  compactCircle,
  compactStyleLocked,
  onToggleCompactStyle,
  voiceControl,
  speakingMessageId,
  onToggleSpeak,
}: Props) {
  const { snapshot, provider, busy, captureBusy, newSession } = agent;
  const captureHandlers = usePanelCaptureHandlers(agent);
  const [historyOpen, setHistoryOpen] = useState(false);
  const view: AgentHeaderView = historyOpen ? "history" : "chat";
  const panelRef = useRef<HTMLElement>(null);
  const { onContentMeasured, onOverlayHeightChange } = usePanelMeasuredHeight(
    historyOpen,
    onMeasured,
  );

  useEffect(() => {
    if (historyOpen) void agent.history.refresh();
  }, [historyOpen, agent.history.refresh]);

  return (
    <AgentPopoverFitProvider panelRef={panelRef} onOverlayHeightChange={onOverlayHeightChange}>
      <section
        ref={panelRef}
        className={`flex h-full min-h-0 flex-col ${eventMotion === "otto-failed" ? "motion-safe:animate-otto-shake" : ""}`}
        data-surface="agent"
        data-status={snapshot.status}
        data-capture-phase={snapshot.capture.phase}
      >
        <AgentHeader
          view={view}
          provider={snapshot.threadId ? snapshot.provider : provider}
          model={agent.model}
          thinkingEffort={agent.thinkingEffort}
          hasThread={snapshot.threadId !== null || snapshot.messages.length > 0}
          resetBusy={busy || captureBusy}
          onBack={() => setHistoryOpen(false)}
          onSettings={onSettings}
          onHistory={() => setHistoryOpen(true)}
          onNewSession={() => void newSession()}
          gearRef={settingsButtonRef}
          compactCircle={compactCircle}
          compactStyleLocked={compactStyleLocked}
          onToggleCompactStyle={onToggleCompactStyle}
          runtimeSwitcher={{
            providers: agent.providers,
            readiness: agent.readiness,
            pinnedModels: agent.pinnedModels,
            rateLimits: resolveRateLimits(provider, agent.readiness, snapshot),
            locked: agent.locked,
            onSelectProvider: agent.setProvider,
            onSelectModel: agent.setModel,
            onTogglePinModel: agent.togglePinnedModel,
            onSelectThinkingEffort: agent.setThinkingEffort,
            onOpenSettings: onSettings,
          }}
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
              activeConversationId={snapshot.messages.length > 0 ? snapshot.conversationId : null}
              busy={busy || captureBusy}
              onDone={() => setHistoryOpen(false)}
              onMeasured={onMeasured}
            />
          ) : (
            <AgentTranscript
              agent={agent}
              captureSource={agent.capture?.source ?? "window"}
              captureShortcut={agent.capture?.shortcut}
              onInsert={agent.insertText}
              captureActionError={captureHandlers.captureActionError}
              onMeasured={onContentMeasured}
              onCapture={captureHandlers.onCapture}
              onCaptureSource={captureHandlers.onCaptureSource}
              onStageImage={captureHandlers.onStageImage}
              onConfigureCapture={onConfigureCapture}
              voiceControl={voiceControl}
              speakingMessageId={speakingMessageId}
              onToggleSpeak={onToggleSpeak}
            />
          )}
        </TransitionContent>
      </section>
    </AgentPopoverFitProvider>
  );
}
