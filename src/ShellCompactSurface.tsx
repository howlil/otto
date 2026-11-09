import { AgentCapsule } from "./features/agent";
import type { useAgent } from "./features/agent";
import { FocusCompactSurface } from "./features/focus";
import type { FocusTimerModel } from "./features/focus";
import { MusicCapsule } from "./features/music";
import type { useMusic } from "./features/music";
import { OsEventCapsule } from "./features/os-events";
import type { useNotchShell } from "./features/shell";
import type { OsEventView } from "./platform/tauri";

type AgentModel = ReturnType<typeof useAgent>;
type MusicModel = ReturnType<typeof useMusic>;
type ShellModel = ReturnType<typeof useNotchShell>;

export function ShellCompactSurface({
  agent,
  music,
  focus,
  shell,
  nudgeMotion,
  osEvent,
}: {
  agent: AgentModel;
  music: MusicModel;
  focus: FocusTimerModel;
  shell: ShellModel;
  nudgeMotion: string;
  osEvent: OsEventView | null;
}) {
  const { isAgent, isMusic, page } = shell;
  if (osEvent) return <OsEventCapsule event={osEvent} />;
  if (page === "focus" || page === "focus-settings") {
    return (
      <FocusCompactSurface
        focus={focus}
        buttonRef={shell.compactButton}
        onOpen={() => shell.open("focus")}
      />
    );
  }
  if (isAgent) {
    return (
      <AgentCapsule
        snapshot={agent.snapshot}
        installed={agent.installed}
        readiness={agent.readiness}
        error={agent.error}
        buttonRef={shell.compactButton}
        onOpen={() => shell.open("agent")}
        motionClass={nudgeMotion}
      />
    );
  }
  return isMusic ? (
    <MusicCapsule
      snapshot={music.snapshot}
      buttonRef={shell.compactButton}
      onOpen={() => shell.open("music")}
      busy={music.busy}
      onToggle={() => music.control("toggle")}
    />
  ) : null;
}
