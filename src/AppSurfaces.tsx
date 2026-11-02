import { AgentCapsule, AgentPanel } from "./features/agent";
import type { useAgent } from "./features/agent";
import { HomeSurface } from "./features/home";
import { OsEventCapsule } from "./features/os-events";
import { GlobalSettings } from "./features/shell";
import type { AppUpdateState, useNotchShell } from "./features/shell";
import type { OsEventView } from "./platform/tauri";
import { Eyes, VisuallyHidden } from "./shared/ui";

type AgentModel = ReturnType<typeof useAgent>;
type ShellModel = ReturnType<typeof useNotchShell>;

type ArtProps = {
  tilt: number;
  gradient: number;
};

export function nudgeMotionClass(shell: ShellModel) {
  if (shell.reducedMotion) return "";
  return shell.eventMotion === "otto-nudge" ? "animate-otto-nudge motion-reduce:animate-none" : "";
}

export function CompactHomeButton({ shell }: { shell: ShellModel }) {
  const { expanded } = shell;
  return (
    <button
      ref={shell.compactButton}
      className={`group absolute left-0 top-0 z-[4] grid h-[42px] w-[92px] place-items-center border-0 bg-transparent p-0 text-inherit transition-[left,top,width,height,background,transform] duration-[420ms] ease-otto ${expanded ? "left-4 top-3 h-[34px] w-[34px] rounded-otto-panel bg-otto-raised-soft text-otto-control-text hover:bg-otto-line-mid active:scale-[0.96]" : ""} ${shell.reducedMotion ? "transition-none" : ""}`}
      type="button"
      aria-expanded={expanded}
      onClick={() => (expanded ? shell.collapse() : shell.open("home"))}
    >
      <Eyes
        expression={shell.prefs.expression}
        reactive={shell.prefs.reactive}
        compact={!expanded}
      />
      <VisuallyHidden>{expanded ? "Collapse Otto" : "Open Otto"}</VisuallyHidden>
    </button>
  );
}

export function CompactSurface({
  agent,
  shell,
  osEvent,
  motionClass,
}: {
  agent: AgentModel;
  shell: ShellModel;
  osEvent: OsEventView | null;
  motionClass: string;
}) {
  if (osEvent) return <OsEventCapsule key={osEvent.id} event={osEvent} />;
  if (!shell.isAgent) return null;
  return (
    <AgentCapsule
      snapshot={agent.snapshot}
      installed={agent.installed}
      readiness={agent.readiness}
      error={agent.error}
      buttonRef={shell.compactButton}
      onOpen={() => shell.open("agent")}
      motionClass={motionClass}
    />
  );
}

export function ExpandedContent({
  agent,
  shell,
  agentHomeCopy,
  artProps,
  onContentMeasured,
  appUpdate,
  motionClass,
}: {
  agent: AgentModel;
  shell: ShellModel;
  agentHomeCopy: string;
  artProps: ArtProps;
  onContentMeasured: (height: number) => void;
  appUpdate: {
    state: AppUpdateState;
    checkForUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
  };
  motionClass: string;
}) {
  if (shell.page === "home")
    return (
      <HomeSurface
        homeGear={shell.homeGear}
        agentSubtitle={agentHomeCopy}
        artProps={artProps}
        onOpenSettings={() => shell.open("global-settings")}
        onOpenAgent={() => shell.open("agent")}
        motionClass={motionClass}
      />
    );
  if (shell.page === "global-settings")
    return (
      <GlobalSettings
        prefs={shell.prefs}
        change={shell.change}
        onBack={shell.back}
        onMeasured={onContentMeasured}
        update={appUpdate}
        reducedMotion={shell.reducedMotion}
        captureProtected={shell.captureProtected}
        captureProtectionSupported={shell.captureProtectionSupported}
        captureProtectionPending={shell.captureProtectionPending}
        captureProtectionError={shell.captureProtectionError}
        setCaptureProtection={shell.setCaptureProtection}
        motionClass={motionClass}
      />
    );
  return (
    <AgentPanel
      agent={agent}
      settings={shell.page === "agent-settings"}
      onSettings={() => shell.open("agent-settings")}
      onSettingsBack={() => shell.setPage("agent")}
      onBack={() => shell.open("home")}
      motionClass={motionClass}
      eventMotion={shell.eventMotion}
      onMeasured={onContentMeasured}
      reducedMotion={shell.reducedMotion}
    />
  );
}
