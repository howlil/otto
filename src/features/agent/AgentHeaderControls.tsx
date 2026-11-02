import type { RefObject } from "react";
import { Eyes, IconButton, Text, VisuallyHidden } from "../../shared/ui";
import type { AgentProvider, AgentStatus, ProviderReadiness } from "../../platform/tauri";
import { agentStatusColor, agentStatusLabel, capturePhaseLabel } from "./status";
import { providerLabel } from "./history-model";
import type { AgentHeaderView } from "./AgentHeader";
import type { AgentPanelModel } from "./view-model";

const titles: Record<AgentHeaderView, string> = {
  chat: "",
  settings: "Agent settings",
  history: "History",
};

function capabilityLabel(readiness: ProviderReadiness["status"]): string {
  if (readiness === "ready") return "Tools disabled";
  if (readiness === "checking") return "Verifying";
  return "Unavailable";
}

function runtimeLabel(model: string | null, thinkingEffort: string | null): string {
  if (!model) return "Model not selected";
  return thinkingEffort ? `${model} · ${thinkingEffort}` : model;
}

export function BackControl({
  view,
  buttonRef,
  onBack,
  onHome,
}: {
  view: AgentHeaderView;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onHome: () => void;
}) {
  if (view !== "chat") {
    return (
      <IconButton
        icon="back"
        label={view === "history" ? "Back to conversation" : "Back to Agent"}
        variant="outlined"
        size={18}
        ref={buttonRef}
        onClick={onBack}
      />
    );
  }
  return (
    <button
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-otto-panel border-0 bg-otto-raised-soft text-otto-control-text transition-[background,transform] duration-150 hover:bg-otto-line-mid active:scale-[0.96]"
      type="button"
      onClick={onHome}
    >
      <Eyes mini />
      <VisuallyHidden>Return to Home</VisuallyHidden>
    </button>
  );
}

export function Identity({
  view,
  provider,
  model,
  thinkingEffort,
  readiness,
}: {
  view: AgentHeaderView;
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
  readiness: ProviderReadiness["status"];
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
          {`${runtimeLabel(model, thinkingEffort)} · ${capabilityLabel(readiness)}`}
        </Text>
      )}
    </div>
  );
}

export function ChatControls({
  status,
  readiness,
  capturePhase,
  hasThread,
  resetBusy,
  eventMotion,
  gearRef,
  historyRef,
  onHistory,
  onNewSession,
  onSettings,
}: {
  status: AgentStatus;
  readiness: ProviderReadiness["status"];
  capturePhase: AgentPanelModel["snapshot"]["capture"]["phase"];
  hasThread: boolean;
  resetBusy: boolean;
  eventMotion?: string;
  gearRef: RefObject<HTMLButtonElement | null>;
  historyRef: RefObject<HTMLButtonElement | null>;
  onHistory: () => void;
  onNewSession: () => void;
  onSettings: () => void;
}) {
  const statusMotion = eventMotion === "otto-completed" ? "motion-safe:animate-otto-done" : "";
  const blockedReason = "Finish or stop the current request first";
  return (
    <>
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-otto-text-secondary"
        aria-live="polite"
      >
        <i
          className={`h-[5px] w-[5px] flex-none rounded-full ${agentStatusColor(status, readiness)} ${statusMotion}`}
        />
        <Text as="span" variant="status">
          {capturePhase !== "idle"
            ? capturePhaseLabel(capturePhase)
            : agentStatusLabel(status, readiness)}
        </Text>
      </span>
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
        label="Agent settings"
        variant="quiet"
        ref={gearRef}
        className="shrink-0"
        onClick={onSettings}
      />
    </>
  );
}
