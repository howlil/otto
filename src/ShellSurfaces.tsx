import { AgentPanel } from "./features/agent";
import type { useAgent } from "./features/agent";
import { FocusPanel } from "./features/focus";
import type { FocusTimerModel } from "./features/focus";
import { HomeSurface } from "./features/home";
import { MusicPanel } from "./features/music";
import type { useMusic } from "./features/music";
import { GlobalSettings } from "./features/shell";
import type { AppUpdateState, useNotchShell } from "./features/shell";
import type { OsEventView } from "./platform/tauri";
import { Eyes, OttoLogo, VisuallyHidden } from "./shared/ui";
import { ShellCompactSurface } from "./ShellCompactSurface";

type AgentModel = ReturnType<typeof useAgent>;
type MusicModel = ReturnType<typeof useMusic>;
type FocusModel = FocusTimerModel;
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
      className={`group absolute top-0 z-[4] grid place-items-center border-0 bg-transparent p-0 text-inherit ${reducedMotion ? "" : "transition-[left,top,translate,width,height] ease-otto"} ${settled ? "left-4 top-3 h-[34px] w-[34px] translate-x-0" : "left-1/2 h-[42px] w-[92px] -translate-x-1/2"}`}
      style={reducedMotion ? undefined : { transitionDuration: "var(--otto-morph-duration)" }}
      type="button"
      aria-expanded={expanded}
      data-anchor={settled ? "corner" : "center"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onToggle}
    >
      {settled ? (
        <OttoLogo expression={prefs.expression} reactive={prefs.reactive} />
      ) : (
        <Eyes expression={prefs.expression} reactive={prefs.reactive} compact />
      )}
      <VisuallyHidden>{expanded ? "Collapse Otto" : "Open Otto"}</VisuallyHidden>
    </button>
  );
}

export function SurfaceBody({
  agent,
  music,
  focus,
  shell,
  agentHomeCopy,
  musicHomeCopy,
  artProps,
  appUpdate,
  onContentMeasured,
  nudgeMotion,
  osEvent,
}: {
  agent: AgentModel;
  music: MusicModel;
  focus: FocusModel;
  shell: ShellModel;
  agentHomeCopy: string;
  musicHomeCopy: string;
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
  const { expanded, isMusic, page } = shell;
  if (!expanded) {
    return (
      <ShellCompactSurface
        agent={agent}
        music={music}
        focus={focus}
        shell={shell}
        nudgeMotion={nudgeMotion}
        osEvent={osEvent}
      />
    );
  }
  if (page === "home") {
    return (
      <HomeSurface
        homeGear={shell.homeGear}
        agentSubtitle={agentHomeCopy}
        musicSubtitle={musicHomeCopy}
        artProps={artProps}
        onOpenSettings={() => shell.open("global-settings")}
        onOpenAgent={() => shell.open("agent")}
        onOpenMusic={() => shell.open("music")}
        onOpenFocus={() => shell.open("focus")}
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
  if (isMusic) {
    return <MusicPanel music={music} onBack={() => shell.open("home")} motionClass={nudgeMotion} />;
  }
  if (page === "focus" || page === "focus-settings") {
    return (
      <FocusPanel
        focus={focus}
        settings={page === "focus-settings"}
        onSettings={() => shell.open("focus-settings")}
        onSettingsBack={() => shell.setPage("focus")}
        onHome={() => shell.open("home")}
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
