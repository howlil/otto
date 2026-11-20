import type { RefObject } from "react";
import { IconButton, OttoLogo, Text } from "../../../shared/ui";
import type { AgentProvider } from "../../../platform/tauri";
import { providerLabel } from "../history/history-model";
import type { AgentHeaderView } from "./AgentHeader";

const titles: Record<AgentHeaderView, string> = {
  chat: "",
  history: "History",
};

function runtimeLabel(model: string | null, thinkingEffort: string | null): string {
  if (!model) return "Model not selected";
  return thinkingEffort ? `${model} · ${thinkingEffort}` : model;
}

export function BackControl({
  view,
  buttonRef,
  onBack,
}: {
  view: AgentHeaderView;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
}) {
  if (view === "chat") return <OttoLogo />;
  return (
    <IconButton
      icon="back"
      label="Back to conversation"
      variant="outlined"
      size={18}
      ref={buttonRef}
      onClick={onBack}
    />
  );
}

export function Identity({
  view,
  provider,
  model,
  thinkingEffort,
}: {
  view: AgentHeaderView;
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
}) {
  return (
    <div className="min-w-0 flex-1">
      <Text
        as="strong"
        variant={view === "chat" ? "title" : "display"}
        className="block overflow-hidden text-ellipsis whitespace-nowrap"
      >
        {view === "chat" ? providerLabel(provider) : titles[view]}
      </Text>
      {view === "chat" && (
        <Text
          as="small"
          variant="meta"
          className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-otto-text-tertiary"
        >
          {runtimeLabel(model, thinkingEffort)}
        </Text>
      )}
    </div>
  );
}

export function ChatControls({
  hasThread,
  resetBusy,
  gearRef,
  historyRef,
  onHistory,
  onNewSession,
  onSettings,
}: {
  hasThread: boolean;
  resetBusy: boolean;
  gearRef: RefObject<HTMLButtonElement | null>;
  historyRef: RefObject<HTMLButtonElement | null>;
  onHistory: () => void;
  onNewSession: () => void;
  onSettings: () => void;
}) {
  const blockedReason = "Finish or stop the current request first";
  return (
    <>
      <IconButton
        icon="history"
        label="Conversation history"
        title={resetBusy ? blockedReason : "Conversation history"}
        variant="quiet"
        ref={historyRef}
        className="shrink-0"
        disabled={resetBusy}
        onClick={onHistory}
      />
      {hasThread && (
        <IconButton
          icon="plus"
          label="New chat"
          title={resetBusy ? blockedReason : "New chat"}
          variant="quiet"
          className="shrink-0"
          disabled={resetBusy}
          onClick={onNewSession}
        />
      )}
      <IconButton
        icon="settings"
        label="Settings"
        variant="quiet"
        ref={gearRef}
        className="shrink-0"
        onClick={onSettings}
      />
    </>
  );
}
