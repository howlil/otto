import { Icon, RadioGroup, StatusMessage, Text, TextField } from "../../shared/ui";
import type { AgentMode, AgentProvider, ProviderReadiness } from "../../platform/tauri";
import { ProviderChoice, type ProviderName } from "./ProviderChoice";

const providers: ReadonlyArray<{
  name: ProviderName;
  command: AgentProvider;
  detail: string;
}> = [
  { name: "Codex", command: "codex", detail: "OpenAI coding agent" },
  { name: "Agy", command: "agy", detail: "Google Antigravity CLI" },
  { name: "Pi", command: "pi", detail: "Minimal coding harness" },
];

export function ProviderSettings({
  readiness,
  providerStatus,
  onRetry,
  provider,
  onSelect,
  locked,
}: {
  readiness: ProviderReadiness;
  providerStatus: string;
  onRetry: () => void;
  provider: AgentProvider;
  onSelect: (provider: AgentProvider) => void;
  locked: boolean;
}) {
  return (
    <section className="border-b border-otto-raised-deep pb-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Text as="span" variant="label" className="text-otto-text-secondary" id="otto-provider-label">
          Choose your agent
        </Text>
        <Text as="span" variant="caption" className="text-otto-text-tertiary">
          Local CLI
        </Text>
      </div>
      <fieldset
        className="grid h-[233px] min-w-0 grid-cols-[1.15fr_1fr] grid-rows-3 gap-2 border-0 p-0"
        aria-labelledby="otto-provider-label"
      >
        {providers.map(({ name, command, detail }) => (
          <ProviderChoice
            key={name}
            name={name}
            command={command}
            detail={detail}
            status={provider === command ? providerStatus : "Select"}
            selected={provider === command}
            locked={locked}
            onSelect={!locked ? () => onSelect(command) : undefined}
          />
        ))}
        <ProviderChoice
          name="OpenCode"
          command="opencode"
          detail="Not supported yet"
          status="Planned"
          selected={false}
          planned
          locked={locked}
        />
      </fieldset>
      <StatusMessage
        tone={
          readiness.status === "ready"
            ? "success"
            : readiness.status === "checking"
              ? "info"
              : "warn"
        }
        className="mt-[10px] rounded-otto-control border border-otto-line-mid bg-otto-field-deep p-[10px] text-otto-text-tertiary [&>div]:min-w-0 [&>div]:flex-1 [&>div>p]:mt-0.5 [&>div>p]:m-0"
        title={providerStatus}
        action={
          readiness.status !== "ready"
            ? { label: "Retry", onClick: onRetry, disabled: readiness.status === "checking" }
            : undefined
        }
      >
        {readiness.message} {readiness.recovery}
      </StatusMessage>
    </section>
  );
}

export function ModeSettings({
  mode,
  locked,
  agentSessionAvailable,
  setMode,
}: {
  mode: AgentMode;
  locked: boolean;
  agentSessionAvailable: boolean;
  setMode: (mode: AgentMode) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-[10px]">
        <Text as="span" variant="meta" className="mb-2 block text-otto-muted-strong">
          Execution mode
        </Text>
        {locked && (
          <Text
            as="span"
            variant="caption"
            className="uppercase tracking-[0.03em] text-otto-text-subtle"
          >
            Locked
          </Text>
        )}
      </div>
      <RadioGroup
        value={mode}
        disabled={locked}
        disabledReason="Start a new session to change mode or project"
        onChange={setMode}
        choices={[
          { value: "quickAsk", label: "Quick Ask", help: "Follow-up supported · no file changes" },
          {
            value: "agentSession",
            label: "Agent Session",
            help: agentSessionAvailable
              ? "Codex only · tools require approval"
              : "Not supported by the current CLI",
            disabled: !agentSessionAvailable,
            disabledReason: "Agent Session is currently available only through Codex",
          },
        ]}
      />
    </section>
  );
}
export function ProjectSettings({
  cwd,
  locked,
  setCwd,
}: {
  cwd: string;
  locked: boolean;
  setCwd: (cwd: string) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-[10px]">
        <label
          className="mb-2 block text-otto-xs leading-[1.4] text-otto-muted-strong"
          htmlFor="otto-project"
        >
          Working project
        </label>
        {locked && (
          <Text
            as="span"
            variant="caption"
            className="uppercase tracking-[0.03em] text-otto-text-subtle"
          >
            Fixed
          </Text>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-[10px] text-otto-label-faded focus-within:border-otto-disabled-selected">
        <Icon name="folder" size={15} />
        <TextField
          id="otto-project"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="Folder path"
          disabled={locked}
          title={locked ? "Start a new session to change the working project" : undefined}
          spellCheck={false}
          className="h-[33px] min-w-0 flex-1 border-0 bg-transparent text-otto-sm text-otto-knob outline-none disabled:opacity-[0.65]"
        />
      </div>
    </section>
  );
}
