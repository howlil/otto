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

export function CompactEyesButton({
  expanded,
  prefs,
  buttonRef,
  reducedMotion,
  onToggle,
}: {
  expanded: boolean;
  prefs: ShellModel["prefs"];
  buttonRef: ShellModel["compactButton"];
  reducedMotion: boolean;
  onToggle: () => void;
}) {
  const settled = expanded;
  return (
    <button
      ref={buttonRef}
      className={`group absolute top-0 z-[4] grid place-items-center border-0 bg-transparent p-0 text-inherit ${reducedMotion ? "" : "transition-[left,top,width,height,transform] ease-otto"} ${settled ? "left-4 top-3 h-[34px] w-[34px] translate-x-0" : "left-1/2 h-[42px] w-[92px] -translate-x-1/2"}`}
      style={reducedMotion ? undefined : { transitionDuration: "var(--otto-morph-duration)" }}
      type="button"
      aria-expanded={expanded}
      data-anchor={settled ? "corner" : "center"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onToggle}
    >
      {settled ? (
        <span
          className="grid h-[34px] w-[34px] place-items-center rounded-otto-panel bg-otto-raised-soft text-otto-control-text transition-[background,transform] duration-[190ms] ease-otto group-hover:bg-otto-line-mid group-active:scale-[0.96]"
          data-otto-logo="true"
        >
          <Eyes expression={prefs.expression} reactive={prefs.reactive} compact />
        </span>
      ) : (
        <Eyes expression={prefs.expression} reactive={prefs.reactive} compact />
      )}
      <VisuallyHidden>{expanded ? "Collapse Otto" : "Open Otto"}</VisuallyHidden>
    </button>
  );
}

export function SurfaceBody({
  agent,
  shell,
  agentHomeCopy,
  artProps,
  appUpdate,
  onContentMeasured,
  nudgeMotion,
  osEvent,
}: {
  agent: AgentModel;
  shell: ShellModel;
  agentHomeCopy: string;
  artProps: { tilt: number; gradient: number };
  appUpdate: {
    state: AppUpdateState;
    checkForUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
  };
  onContentMeasured: (height: number) => void;
  nudgeMotion: string;
  osEvent: OsEventView | null;
}) {
  const { expanded, isAgent, page } = shell;
  if (!expanded) {
    if (osEvent) return <OsEventCapsule event={osEvent} />;
    return isAgent ? (
      <AgentCapsule
        snapshot={agent.snapshot}
        installed={agent.installed}
        readiness={agent.readiness}
        error={agent.error}
        buttonRef={shell.compactButton}
        onOpen={() => shell.open("agent")}
        motionClass={nudgeMotion}
      />
    ) : null;
  }
  if (page === "home") {
    return (
      <HomeSurface
        homeGear={shell.homeGear}
        agentSubtitle={agentHomeCopy}
        artProps={artProps}
        onOpenSettings={() => shell.open("global-settings")}
        onOpenAgent={() => shell.open("agent")}
        motionClass={nudgeMotion}
      />
    );
  }
  if (page === "global-settings") {
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
        osEventsError={shell.osEventsError}
        placement={shell.placement}
        motionClass={nudgeMotion}
      />
    );
  }
  return (
    <AgentPanel
      agent={agent}
      settings={page === "agent-settings"}
      onSettings={() => shell.open("agent-settings")}
      onSettingsBack={() => shell.setPage("agent")}
      onBack={() => shell.open("home")}
      motionClass={nudgeMotion}
      eventMotion={shell.eventMotion}
      onMeasured={onContentMeasured}
      reducedMotion={shell.reducedMotion}
    />
  );
}
