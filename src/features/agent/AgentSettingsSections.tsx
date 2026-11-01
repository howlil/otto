import { Icon, RadioGroup, StatusMessage, Text, TextField } from "../../shared/ui";
import type { AgentMode, AgentProvider, ProviderReadiness } from "../../platform/tauri";
import { ProviderChoice, type ProviderTone } from "./ProviderChoice";

type ProviderName = "Codex" | "Pi" | "Agy";

const providers: ReadonlyArray<{ name: ProviderName; mark: string; tone: ProviderTone }> = [
  { name: "Codex", mark: "✦", tone: "codex" },
  { name: "Agy", mark: "A", tone: "agy" },
  { name: "Pi", mark: "π", tone: "pi" },
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
    <section className="border-b border-otto-raised-deep pb-3 pt-[5px]">
      <div className="flex items-center justify-between gap-[10px]">
        <Text
          as="span"
          variant="meta"
          className="mb-2 block text-otto-muted-strong"
          id="otto-provider-label"
        >
          Provider
        </Text>
        <Text
          as="span"
          variant="caption"
          className="uppercase tracking-[0.03em] text-otto-text-subtle"
        >
          {provider === "pi" ? "Pi" : provider === "agy" ? "Agy" : "Codex"}
        </Text>
      </div>
      <fieldset
        className="m-0 grid min-w-0 grid-cols-3 gap-[7px] border-0 p-0"
        aria-labelledby="otto-provider-label"
      >
        {providers.map(({ name, mark, tone }) => {
          const selected = name.toLowerCase() === provider;
          return (
            <ProviderChoice
              key={name}
              name={name}
              mark={mark}
              tone={tone}
              status={selected ? providerStatus : "Select"}
              selected={selected}
              onSelect={
                !locked
                  ? () => onSelect(name === "Pi" ? "pi" : name === "Agy" ? "agy" : "codex")
                  : undefined
              }
            />
          );
        })}
      </fieldset>
      {readiness.status !== "ready" && (
        <StatusMessage
          tone="warn"
          className="mt-[10px] text-otto-text-tertiary [&>div]:min-w-0 [&>div]:flex-1 [&>div>p]:mt-0.5 [&>div>p]:m-0"
          title={providerStatus}
          action={{ label: "Retry", onClick: onRetry, disabled: readiness.status === "checking" }}
        >
          {readiness.message} {readiness.recovery}
        </StatusMessage>
      )}
    </section>
  );
}

export function ModeSettings({
  mode,
  locked,
  setMode,
}: {
  mode: AgentMode;
  locked: boolean;
  setMode: (mode: AgentMode) => void;
}) {
  return (
    <section className="border-b border-otto-raised-deep py-3">
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
          { value: "quickAsk", label: "Quick Ask" },
          { value: "agentSession", label: "Agent Session" },
        ]}
      />
      <StatusMessage
        tone="info"
        className="mt-2.5 block border border-otto-line-mid rounded-otto-chip bg-otto-field-deep p-[9px_10px] text-otto-text-tertiary [&>div>p]:m-0 [&>div>p]:mt-0.5"
        title="Execution scope"
      >
        Quick Ask uses a read-only Codex sandbox or tool-free Pi/Agy sessions. Agent Session is
        currently Codex-only.
      </StatusMessage>
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
    <section className="border-b border-otto-raised-deep py-3">
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
