import { useEffect, useRef, type RefObject } from "react";
import type { AgentProvider } from "../../../platform/tauri";
import { BackControl, ChatControls, Identity } from "./AgentHeaderControls";
import { EngineQuickSwitcher, type HeaderRuntimeSwitcher } from "./EngineQuickSwitcher";

export type AgentHeaderView = "chat" | "history";

export function AgentHeader({
  view,
  provider,
  model,
  thinkingEffort,
  hasThread,
  resetBusy,
  onBack,
  onSettings,
  onHistory,
  onNewSession,
  gearRef,
  runtimeSwitcher,
}: {
  view: AgentHeaderView;
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
  hasThread: boolean;
  resetBusy: boolean;
  onBack: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onNewSession: () => void;
  gearRef: RefObject<HTMLButtonElement | null>;
  runtimeSwitcher?: HeaderRuntimeSwitcher;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    if (view !== "chat") back.current?.focus({ preventScroll: true });
    else if (previousView.current === "history")
      historyButton.current?.focus({ preventScroll: true });
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
      <BackControl view={view} buttonRef={back} onBack={onBack} />
      {view === "chat" && runtimeSwitcher ? (
        <EngineQuickSwitcher
          provider={provider}
          model={model}
          thinkingEffort={thinkingEffort}
          switcher={runtimeSwitcher}
        />
      ) : (
        <Identity view={view} provider={provider} model={model} thinkingEffort={thinkingEffort} />
      )}
      {view === "chat" && (
        <ChatControls
          hasThread={hasThread}
          resetBusy={resetBusy}
          gearRef={gearRef}
          historyRef={historyButton}
          onHistory={onHistory}
          onNewSession={onNewSession}
          onSettings={onSettings}
        />
      )}
    </header>
  );
}
