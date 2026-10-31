import { useEffect, useRef, useState } from "react";
import { Eyes, Icon, IconButton, VisuallyHidden } from "../../shared/ui";
import { AgentSettings } from "./AgentSettings";
import { AgentTranscript } from "./AgentTranscript";
import { agentStatusLabel } from "./status";
import type { useAgent } from "./useAgent";

type AgentController = ReturnType<typeof useAgent>;
type Props = {
  agent: AgentController;
  settings: boolean;
  onSettings: () => void;
  onSettingsBack: () => void;
  onBack: () => void;
  onCollapse: () => void;
};

// The panel is the container: it owns focus, the denial flag and which surface
// is shown, and composes the settings surface or the transcript. It has no run
// state of its own.
export function AgentPanel({
  agent,
  settings,
  onSettings,
  onSettingsBack,
  onBack,
  onCollapse,
}: Props) {
  const { snapshot, installed, readiness, cwd, setCwd, mode, setMode, locked, busy, newSession } = agent;
  const [denied, setDenied] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const previousSettings = useRef(settings);

  const approval = snapshot.approval;
  const approvalPending = snapshot.status === "approvalRequired" && Boolean(approval);
  const project =
    (snapshot.threadId ? snapshot.cwd : cwd || snapshot.cwd).split(/[\\/]/).filter(Boolean).pop() ||
    "Workspace";
  // The effective mode after submit is Rust's; the draft only drives the label
  // before a thread exists (DEC9).
  const effectiveMode = snapshot.threadId ? snapshot.mode : mode;
  const scopeLabel =
    effectiveMode === "agentSession"
      ? "Agent Session · Workspace write"
      : "Quick Ask · Read-only sandbox";

  useEffect(() => {
    // A new turn clears the previous outcome; Deny itself passes through
    // "streaming" before the turn terminalises as "stopped".
    if (snapshot.status === "starting") setDenied(false);
  }, [snapshot.status]);
  useEffect(() => {
    if (settings) back.current?.focus({ preventScroll: true });
    else if (previousSettings.current) gear.current?.focus({ preventScroll: true });
    previousSettings.current = settings;
  }, [settings]);

  return (
    <section className="otto-agent flex h-full min-h-0 flex-col" data-status={snapshot.status}>
      <header className="otto-agent-head flex shrink-0 items-center gap-[9px]">
        {settings ? (
          <button className="otto-eye-button" type="button" ref={back} onClick={onSettingsBack}>
            <Icon name="back" size={19} />
            <VisuallyHidden>Back to Agent</VisuallyHidden>
          </button>
        ) : (
          <button className="otto-eye-button" type="button" onClick={onCollapse}>
            <Eyes mini />
            <VisuallyHidden>Collapse Agent</VisuallyHidden>
          </button>
        )}
        <div className="otto-agent-identity min-w-0 flex-1">
          <strong>
            {settings ? (
              "Agent settings"
            ) : (
              <>
                Codex <em>/ {project}</em>
              </>
            )}
          </strong>
          <small>{settings ? "Local CLI configuration" : scopeLabel}</small>
        </div>
        {!settings && (
          <>
            <span className="otto-agent-status" aria-live="polite">
              <i />
              {snapshot.status === "streaming" && snapshot.activity
                ? "Using tool"
                : agentStatusLabel(snapshot.status)}
            </span>
            <IconButton
              icon="settings"
              label="Agent settings"
              ref={gear}
              className="otto-gear"
              onClick={onSettings}
            />
          </>
        )}
      </header>
      {settings ? (
        <AgentSettings
          readiness={readiness}
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
