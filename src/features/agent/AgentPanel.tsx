import { useEffect, useRef, useState, type FormEvent } from "react";
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

function AgentIcon({
  name,
  size = 16,
}: {
  name: "settings" | "back" | "camera" | "send" | "stop" | "copy" | "folder" | "alert";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "settings" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.7 5.7l1.5 1.5m9.6 9.6 1.5 1.5m0-12.6-1.5 1.5M7.2 16.8l-1.5 1.5" />
        </>
      )}
      {name === "back" && <path d="m15 18-6-6 6-6" />}
      {name === "camera" && (
        <>
          <path d="M3 7h4l2-2h6l2 2h4v12H3z" />
          <circle cx="12" cy="13" r="3" />
        </>
      )}
      {name === "send" && (
        <>
          <path d="M12 19V5m-6 6 6-6 6 6" />
        </>
      )}
      {name === "stop" && <rect x="6" y="6" width="12" height="12" rx="2" />}
      {name === "copy" && (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
        </>
      )}
      {name === "folder" && <path d="M3 6h6l2 2h10v11H3z" />}
      {name === "alert" && (
        <>
          <path d="M12 4 2.5 20h19z" />
          <path d="M12 10v4m0 3v.5" />
        </>
      )}
    </svg>
  );
}
function Bars() {
  return (
    <span className="otto-bars live" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
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
            <AgentIcon name="back" size={19} />
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
              <AgentIcon name="settings" />
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
          <div className="otto-mode-list flex flex-col gap-[6px]">
            <button
              type="button"
              className={mode === "quickAsk" ? "selected" : ""}
              aria-pressed={mode === "quickAsk"}
              disabled={locked}
              title={locked ? "Stop current work before changing mode" : undefined}
              onClick={() => setMode("quickAsk")}
            >
              <i className="otto-mode-radio" />{" "}
              <span>
                <strong>Quick Ask</strong>
                <small>Provider-enforced read-only execution</small>
              </span>
            </button>
            <button
              type="button"
              className={mode === "agentSession" ? "selected" : ""}
              aria-pressed={mode === "agentSession"}
              disabled={locked}
              title={locked ? "Stop current work before changing mode" : undefined}
              onClick={() => setMode("agentSession")}
            >
              <i className="otto-mode-radio" />
              <span>
                <strong>Agent Session</strong>
                <small>Workspace write · asks before tools and file changes</small>
              </span>
            </button>
          </div>
          <div className="otto-settings-divider" />
          <label className="otto-field-name" htmlFor="otto-project">
            Working project
          </label>
          <div className="otto-project-input flex items-center gap-2">
            <AgentIcon name="folder" size={15} />
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
                    <AgentIcon name="alert" size={15} />
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
                    <AgentIcon name="copy" size={13} /> Copy answer
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
                <AgentIcon name="camera" />
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
                  <AgentIcon name="stop" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="Send prompt"
                  title="Send"
                  className="otto-round-action primary"
                  disabled={!canSend}
                >
                  <AgentIcon name="send" />
                </button>
              )}
            </form>
          </div>
        </>
      )}
    </section>
  );
}
