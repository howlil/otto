import { useEffect, useRef, useState } from "react";
import { Eyes, IconButton, Text, VisuallyHidden } from "../../shared/ui";
import type { AgentStatus, ProviderReadiness } from "../../platform/tauri";
import { AgentSettings } from "./AgentSettings";
import { AgentTranscript } from "./AgentTranscript";
import { agentStatusLabel } from "./status";
import type { AgentPanelModel } from "./view-model";

type Props = {
  agent: AgentPanelModel;
  settings: boolean;
  onSettings: () => void;
  onSettingsBack: () => void;
  onBack: () => void;
  onCollapse: () => void;
  motionClass?: string;
  eventMotion?: string;
};

export function AgentPanel({
  agent,
  settings,
  onSettings,
  onSettingsBack,
  onBack,
  onCollapse,
  motionClass = "",
  eventMotion,
}: Props) {
  const { snapshot, readiness, cwd, setCwd, mode, setMode, locked, busy, newSession } = agent;
  const [denied, setDenied] = useState(false);
  const approval = snapshot.approval;
  const approvalPending = snapshot.status === "approvalRequired" && Boolean(approval);
  const project =
    (snapshot.threadId ? snapshot.cwd : cwd || snapshot.cwd).split(/[\\/]/).filter(Boolean).pop() ||
    "Workspace";

  useEffect(() => {
    if (snapshot.status === "starting") setDenied(false);
  }, [snapshot.status]);

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
        status={snapshot.status}
        readiness={readiness.status}
        activity={Boolean(snapshot.activity)}
        eventMotion={eventMotion}
        onSettings={onSettings}
        onSettingsBack={onSettingsBack}
        onCollapse={onCollapse}
      />
      {settings ? (
        <AgentSettings
          readiness={readiness}
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
          onBack={onBack}
          onDone={onSettingsBack}
        />
      ) : (
        <AgentTranscript
          agent={agent}
          denied={denied}
          approvalPending={approvalPending}
          onDenied={() => setDenied(true)}
        />
      )}
    </section>
  );
}
function AgentHeader({
  settings,
  project,
  mode,
  status,
  readiness,
  activity,
  eventMotion,
  onSettings,
  onSettingsBack,
  onCollapse,
}: {
  settings: boolean;
  project: string;
  mode: AgentPanelModel["snapshot"]["mode"];
  status: AgentStatus;
  readiness: ProviderReadiness["status"];
  activity: boolean;
  eventMotion?: string;
  onSettings: () => void;
  onSettingsBack: () => void;
  onCollapse: () => void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const previousSettings = useRef(settings);
  const statusColor =
    status === "approvalRequired"
      ? "bg-otto-warn"
      : status === "failed"
        ? "bg-otto-danger"
        : status === "stopped"
          ? "bg-otto-text-tertiary"
          : "bg-otto-ok";
  const statusMotion = eventMotion === "otto-completed" ? "motion-safe:animate-otto-done" : "";
  const scopeLabel =
    mode === "agentSession" ? "Agent Session · Workspace write" : "Quick Ask · Read-only sandbox";
  useEffect(() => {
    if (settings) back.current?.focus({ preventScroll: true });
    else if (previousSettings.current) gear.current?.focus({ preventScroll: true });
    previousSettings.current = settings;
  }, [settings]);
  return (
    <header className="flex h-[53px] shrink-0 items-center gap-[9px] px-[15px] pb-[5px] pt-[9px]">
      {settings ? (
        <IconButton
          icon="back"
          label="Back to Agent"
          variant="raised"
          size={19}
          ref={back}
          onClick={onSettingsBack}
        />
      ) : (
        <button
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-otto-panel border-0 bg-otto-raised-soft text-otto-control-text transition-[background,transform] duration-150 hover:bg-otto-line-mid active:scale-[0.96]"
          type="button"
          onClick={onCollapse}
        >
          <Eyes mini />
          <VisuallyHidden>Collapse Agent</VisuallyHidden>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <Text
          as="strong"
          variant="title"
          className="block overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {settings ? (
            "Agent settings"
          ) : (
            <>
              Codex <em className="font-normal text-otto-line-focused">/ {project}</em>
            </>
          )}
        </Text>
        <Text
          as="small"
          variant="meta"
          className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-otto-text-tertiary"
        >
          {settings ? "Local CLI configuration" : scopeLabel}
        </Text>
      </div>
      {!settings && (
        <>
          <span
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-otto-text-secondary"
            aria-live="polite"
          >
            <i
              className={`h-[5px] w-[5px] flex-none rounded-full ${statusColor} ${statusMotion}`}
            />
            <Text as="span" variant="status">
              {status === "streaming" && activity
                ? "Using tool"
                : agentStatusLabel(status, readiness)}
            </Text>
          </span>
          <IconButton
            icon="settings"
            label="Agent settings"
            variant="quiet"
            ref={gear}
            className="shrink-0"
            onClick={onSettings}
          />
        </>
      )}
    </header>
  );
}
