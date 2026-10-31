import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bars, ChoiceRow, Icon } from "../../shared/ui";
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

export function AgentPanel({
  agent,
  settings,
  onSettings,
  onSettingsBack,
  onBack,
  onCollapse,
}: Props) {
  const {
    snapshot,
    installed,
    cwd,
    setCwd,
    draft,
    setDraft,
    mode,
    setMode,
    locked,
    error,
    busy,
    send,
    stop,
    decide,
    refreshProvider,
  } = agent;
  const [notice, setNotice] = useState("");
  const [denied, setDenied] = useState(false);
  const feed = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const previousSettings = useRef(settings);
  const nearBottom = useRef(true);
  const project =
    (snapshot.threadId ? snapshot.cwd : cwd || snapshot.cwd).split(/[\\/]/).filter(Boolean).pop() ||
    "Workspace";
  const approval = snapshot.approval;
  const approvalPending = snapshot.status === "approvalRequired" && Boolean(approval);
  const canSend = !busy && installed === true && draft.trim().length > 0;
  // The effective mode after submit is Rust's; the draft only drives the label
  // before a thread exists.
  const effectiveMode = snapshot.threadId ? snapshot.mode : mode;
  const scopeLabel =
    effectiveMode === "agentSession"
      ? "Agent Session · Workspace write"
      : "Quick Ask · Read-only sandbox";
  // Design keeps a distinct "Using tool" state; in production it is the
  // streaming phase with real tool activity, never a timer or simulation.
  const headerStatus =
    snapshot.status === "streaming" && snapshot.activity
      ? "Using tool"
      : agentStatusLabel(snapshot.status);

  useEffect(() => {
    if (settings) back.current?.focus({ preventScroll: true });
    else if (previousSettings.current) gear.current?.focus({ preventScroll: true });
    previousSettings.current = settings;
  }, [settings]);
  useEffect(() => {
    // A new turn clears the previous outcome; Deny itself passes through
    // "streaming" before the turn terminalises as "stopped".
    if (snapshot.status === "starting") setDenied(false);
  }, [snapshot.status]);
  useEffect(() => {
    if (snapshot.seq > 0 && nearBottom.current && !settings)
      feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [snapshot.seq, settings]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) void send();
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Answer copied");
    } catch {
      setNotice("Clipboard is unavailable.");
    }
  };
  const lastAnswer = [...snapshot.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.text.length > 0);
  const issue =
    error ||
    (installed === false ? "Codex CLI not found. Install Codex or check PATH, then retry." : "");
  return (
    <section
      className="otto-agent flex h-full min-h-0 flex-col"
      aria-label="Otto Agent"
      data-status={snapshot.status}
    >
      <header className="otto-agent-head flex shrink-0 items-center gap-[9px]">
        {settings ? (
          <button
            className="otto-eye-button"
            type="button"
            ref={back}
            onClick={onSettingsBack}
            aria-label="Back to Agent"
          >
            <Icon name="back" size={19} />
          </button>
        ) : (
          <button
            className="otto-eye-button"
            type="button"
            onClick={onCollapse}
            aria-label="Collapse Agent"
          >
            <span className="otto-eyes mini" aria-hidden="true">
              <i />
              <i />
            </span>
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
              {headerStatus}
            </span>
            <button
              type="button"
              className="otto-gear"
              ref={gear}
              onClick={onSettings}
              aria-label="Agent settings"
            >
              <Icon name="settings" />
            </button>
          </>
        )}
      </header>

      {settings ? (
        <div className="otto-agent-settings flex min-h-0 flex-1 flex-col overflow-y-auto">
          <p className="otto-settings-intro">Choose what Otto uses when you send a request.</p>
          <span className="otto-field-name">Provider</span>
          <div className="otto-provider-grid grid grid-cols-4 gap-[7px]">
            {(["Codex", "Agy", "Pi", "OpenCode"] as const).map((name) => (
              <button
                type="button"
                key={name}
                className={name === "Codex" ? "selected" : ""}
                disabled={name !== "Codex"}
                aria-pressed={name === "Codex"}
                title={name === "Codex" ? "Currently selected" : "Not integrated yet"}
              >
                {name}
                <small>
                  {name === "Codex"
                    ? installed === false
                      ? "Unavailable"
                      : "Selected"
                    : "Not available"}
                </small>
              </button>
            ))}
          </div>
          <div className="otto-settings-divider" />
          <span className="otto-field-name">Execution mode</span>
          <ChoiceRow
            value={mode}
            disabled={locked}
            disabledReason="Stop current work before changing mode"
            onChange={setMode}
            choices={[
              {
                value: "quickAsk",
                title: "Quick Ask",
                help: "Provider-enforced read-only execution",
              },
              {
                value: "agentSession",
                title: "Agent Session",
                help: "Workspace write · asks before tools and file changes",
              },
            ]}
          />
          <div className="otto-settings-divider" />
          <label className="otto-field-name" htmlFor="otto-project">
            Working project
          </label>
          <div className="otto-project-input flex items-center gap-2">
            <Icon name="folder" size={15} />
            <input
              id="otto-project"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="Absolute project folder"
              disabled={locked}
              spellCheck={false}
            />
          </div>
          {snapshot.threadId && (
            <p className="otto-settings-note">
              This conversation's working folder is locked until a new session.
            </p>
          )}
          <div className="otto-agent-settings-bottom flex items-center justify-between gap-[10px]">
            <button type="button" className="otto-agent-home-link" onClick={onBack}>
              Home
            </button>
            <span>
              {installed === false
                ? "Codex is not installed."
                : "Codex authentication is checked on request."}
            </span>
            <button type="button" className="otto-settings-done" onClick={onSettingsBack}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="otto-agent-feed min-w-0 min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
            ref={feed}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            onScroll={(event) => {
              const el = event.currentTarget;
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
          >
            <div className="otto-feed-stack flex min-w-0 flex-col gap-[11px]">
              {snapshot.messages.length === 0 && !busy && (
                <p className="otto-empty-agent">Ask Codex about your current task</p>
              )}
              {snapshot.messages.map((message, index) =>
                message.role === "user" ? (
                  <div className="otto-question" key={message.id}>
                    {message.text}
                  </div>
                ) : (
                  <div key={message.id} className="otto-response">
                    {message.text || busy ? (
                      <>
                        {message.text}
                        {busy && index === snapshot.messages.length - 1 && (
                          <span className="otto-caret" />
                        )}
                      </>
                    ) : null}
                  </div>
                ),
              )}
              {busy && (
                <div className="otto-agent-activity flex items-center gap-[7px]">
                  <Bars />
                  {snapshot.status === "starting"
                    ? "Reading context"
                    : snapshot.status === "stopping"
                      ? "Stopping request"
                      : snapshot.status === "approvalRequired"
                        ? "Waiting for your approval"
                        : snapshot.activity
                          ? snapshot.activity.kind === "fileChange"
                            ? "Changing files"
                            : "Inspecting workspace"
                          : "Writing response"}
                </div>
              )}
              {busy && snapshot.activity && (
                <div className="otto-tool">
                  {snapshot.activity.kind === "fileChange" ? "Write" : "Run"} ·{" "}
                  {snapshot.activity.summary}
                </div>
              )}
              {approvalPending && approval && (
                <div className="otto-approval" role="alertdialog" aria-label="Approval required">
                  <div className="otto-approval-head flex items-center gap-[7px]">
                    <Icon name="alert" size={15} />
                    Approval required
                  </div>
                  <p>{approval.title}. Codex needs your permission before this continues.</p>
                  <code>{approval.detail}</code>
                  {approval.reason && (
                    <p className="otto-approval-reason">Reason: {approval.reason}</p>
                  )}
                  <p className="otto-approval-scope">
                    Agent Session · Workspace write — allowing runs this action once only.
                  </p>
                  <div className="otto-approval-buttons flex gap-[7px]">
                    <button
                      type="button"
                      onClick={() => void decide(approval.approvalId, "allowOnce")}
                    >
                      Allow once
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        // Deny maps to the provider's `cancel`: the turn is
                        // interrupted, so the outcome must be distinguishable
                        // from a plain Stop, exactly as design/agent.html shows.
                        if (await decide(approval.approvalId, "deny")) setDenied(true);
                      }}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}
              {snapshot.status === "stopped" && (
                <p className="otto-agent-hint">
                  {denied ? "Approval denied. No file was changed." : "Request stopped"}
                </p>
              )}
              {issue && (
                <div className="otto-error-card" role="alert">
                  <strong>Codex unavailable</strong>
                  <p>{issue}</p>
                  <button type="button" onClick={() => void refreshProvider()}>
                    Retry
                  </button>
                </div>
              )}
              {snapshot.status === "completed" && lastAnswer && (
                <div className="otto-response-actions">
                  <button type="button" onClick={() => void copy(lastAnswer.text)}>
                    <Icon name="copy" size={13} /> Copy answer
                  </button>
                </div>
              )}
              {notice && (
                <p className="otto-agent-hint" role="status">
                  {notice}
                </p>
              )}
            </div>
          </div>
          <div className="otto-agent-compose-wrap shrink-0">
            <form className="otto-agent-composer flex items-center gap-[5px]" onSubmit={submit}>
              <button
                type="button"
                disabled
                aria-label="Capture not available yet"
                title="Screen capture is not available in this slice"
                className="otto-round-action grid shrink-0 place-items-center rounded-full"
              >
                <Icon name="camera" />
              </button>
              <textarea
                rows={1}
                aria-label="Question for Codex"
                placeholder="Ask Codex…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy || approvalPending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (canSend) void send();
                  }
                }}
              />
              {busy ? (
                <button
                  type="button"
                  aria-label="Stop Codex"
                  title="Stop"
                  className="otto-round-action primary"
                  onClick={() => void stop()}
                  disabled={snapshot.status === "stopping"}
                >
                  <Icon name="stop" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="Send prompt"
                  title="Send"
                  className="otto-round-action primary"
                  disabled={!canSend}
                >
                  <Icon name="send" />
                </button>
              )}
            </form>
          </div>
        </>
      )}
    </section>
  );
}
