import { useEffect, useRef } from "react";
import { Text } from "../../shared/ui";
import type { AgentProvider, AgentStatus, ProviderReadiness } from "../../platform/tauri";
import { BackControl, ChatControls, Identity } from "./AgentHeaderControls";
import { providerLabel } from "./history-model";
import type { AgentPanelModel } from "./view-model";

export type AgentHeaderView = "chat" | "settings" | "history";

export function AgentHeader({
  view,
  provider,
  model,
  thinkingEffort,
  status,
  hasThread,
  resetBusy,
  capturePhase,
  readiness,
  eventMotion,
  onBack,
  onSettings,
  onHistory,
  onNewSession,
  onHome,
}: {
  view: AgentHeaderView;
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
  status: AgentStatus;
  hasThread: boolean;
  resetBusy: boolean;
  capturePhase: AgentPanelModel["snapshot"]["capture"]["phase"];
  readiness: ProviderReadiness["status"];
  eventMotion?: string;
  onBack: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onNewSession: () => void;
  onHome: () => void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    if (view !== "chat") back.current?.focus({ preventScroll: true });
    else if (previousView.current === "history")
      historyButton.current?.focus({ preventScroll: true });
    else if (previousView.current !== "chat") gear.current?.focus({ preventScroll: true });
    previousView.current = view;
  }, [view]);
  return (
    <header
      className={
        view === "chat"
          ? "flex h-[53px] shrink-0 items-center gap-[9px] px-[15px] pb-[5px] pt-[9px]"
          : "flex h-[51px] shrink-0 items-center gap-[9px] border-b border-otto-line-soft px-[15px]"
      }
    >
      <BackControl view={view} buttonRef={back} onBack={onBack} onHome={onHome} />
      <Identity
        view={view}
        provider={provider}
        model={model}
        thinkingEffort={thinkingEffort}
        readiness={readiness}
      />
      {view === "settings" && (
        <Text as="span" variant="status" className="text-otto-label-muted">
          {providerLabel(provider)}
        </Text>
      )}
      {view === "history" && (
        <Text as="span" variant="status" className="text-otto-label-muted">
          Local
        </Text>
      )}
      {view === "chat" && (
        <ChatControls
          status={status}
          readiness={readiness}
          capturePhase={capturePhase}
          hasThread={hasThread}
          resetBusy={resetBusy}
          eventMotion={eventMotion}
          gearRef={gear}
          historyRef={historyButton}
          onHistory={onHistory}
          onNewSession={onNewSession}
          onSettings={onSettings}
        />
      )}
    </header>
  );
}
