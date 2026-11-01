import { useEffect, useRef } from "react";
import { Eyes, IconButton, Text, VisuallyHidden } from "../../shared/ui";
import type { AgentStatus, ProviderReadiness } from "../../platform/tauri";
import { agentStatusColor, agentStatusLabel } from "./status";
import type { AgentPanelModel } from "./view-model";

export function AgentHeader({
  settings,
  project,
  mode,
  provider,
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
  provider: AgentPanelModel["provider"];
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
  const statusColor = agentStatusColor(status, readiness);
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
              {provider === "pi" ? "Pi" : "Codex"}{" "}
              <em className="font-normal text-otto-line-focused">/ {project}</em>
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
