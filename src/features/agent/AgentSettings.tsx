import { ChoiceRow, Icon } from "../../shared/ui";
import type { AgentMode, ProviderReadiness } from "../../platform/tauri";

// The secondary in-island settings surface for the agent. It owns no state:
// the panel keeps the draft and passes it down, so the effective mode always
// comes from Rust once a conversation exists.
export function AgentSettings({
  readiness,
  onRetry,
  mode,
  setMode,
  locked,
  cwd,
  setCwd,
  hasThread,
  busy,
  error,
  onNewSession,
  onBack,
  onDone,
}: {
  readiness: ProviderReadiness;
  onRetry: () => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  locked: boolean;
  cwd: string;
  setCwd: (cwd: string) => void;
  hasThread: boolean;
  busy: boolean;
  error: string | null;
  onNewSession: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const providers = ["Codex", "Agy", "Pi", "OpenCode"] as const;
  return (
    <div className="otto-agent-settings flex min-h-0 flex-1 flex-col overflow-y-auto">
      <p className="otto-settings-intro">Choose what Otto uses when you send a request.</p>
      <span className="otto-field-name">Provider</span>
      <div className="otto-provider-grid grid grid-cols-4 gap-[7px]">
        {providers.map((name) => (
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
                ? readiness.status === "ready"
                  ? "Ready"
                  : readiness.status === "checking"
                    ? "Checking"
                    : "Setup needed"
                : "Not available"}
            </small>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="otto-settings-note" role="status">
          {readiness.message} {readiness.recovery}
        </p>
        {readiness.status !== "ready" && (
          <button
            type="button"
            className="otto-settings-done"
            disabled={readiness.status === "checking"}
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
      <div className="otto-settings-divider" />
      <span className="otto-field-name">Execution mode</span>
      <ChoiceRow
        value={mode}
        disabled={locked}
        disabledReason="Start a new session to change mode or project"
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
      {hasThread && (
        <div className="otto-settings-session flex items-center justify-between gap-3">
          <p className="otto-settings-note">
            Mode and project are fixed for this conversation. New Session clears its transcript.
          </p>
          <button
            type="button"
            className="otto-settings-done"
            disabled={busy}
            onClick={onNewSession}
          >
            New Session
          </button>
        </div>
      )}
      {error && (
        <p className="otto-settings-note" role="alert">
          {error}
        </p>
      )}
      <div className="otto-agent-settings-bottom flex items-center justify-between gap-[10px]">
        <button type="button" className="otto-agent-home-link" onClick={onBack}>
          Home
        </button>
        <span>
          {readiness.status === "ready"
            ? "Codex is configured."
            : "Provider setup is required before sending."}
        </span>
        <button type="button" className="otto-settings-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
