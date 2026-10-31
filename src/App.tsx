import { useEffect, useRef } from "react";
import agentArt from "./assets/agent-art.svg";
import musicArt from "./assets/music-art.svg";
import focusArt from "./assets/focus-art.svg";
import { AgentCapsule, AgentPanel, useAgent } from "./features/agent";
import { HomeCard } from "./features/home";
import { GlobalSettings, resolveSurface, useNotchShell } from "./features/shell";
import { setNotchSurface } from "./platform/tauri";
import { Eyes, IconButton, VisuallyHidden } from "./shared/ui";

export default function App() {
  const agent = useAgent();
  const shell = useNotchShell();
  const {
    page,
    setPage,
    expanded,
    pinned,
    setPinned,
    prefs,
    change,
    notice,
    setNotice,
    eventMotion,
    setEventMotion,
    reducedMotion,
    isAgent,
    compactButton,
    homeGear,
    collapse,
    open,
    back,
    handleEnter,
    handleLeave,
    handleEscape,
  } = shell;

  const surface = resolveSurface({
    expanded,
    isAgent,
    page,
    installed: agent.installed,
    error: agent.error,
    snapshot: agent.snapshot,
  });
  const artProps = {
    parallax: prefs.parallax,
    reduced: reducedMotion || prefs.motion === "reduced",
    amount: prefs.motion === "gentle" ? 2 : 5,
    tilt: prefs.tilt,
    gradient: prefs.gradient,
  };

  useEffect(() => {
    void setNotchSurface(surface, prefs.topOffset, !reducedMotion).catch(() => {
      setNotice("Notch resizing is unavailable in this Windows session.");
    });
  }, [surface, prefs.topOffset, reducedMotion, setNotice]);

  // Event motion: one-shot feedback for a real state change, never a loop.
  const lastStatus = useRef(agent.snapshot.status);
  useEffect(() => {
    const previous = lastStatus.current;
    const current = agent.snapshot.status;
    lastStatus.current = current;
    if (previous === current) return;
    setEventMotion("");
    const cue =
      current === "completed"
        ? "otto-completed"
        : current === "failed"
          ? "otto-failed"
          : current === "approvalRequired"
            ? "otto-nudge"
            : null;
    if (!cue) return;
    setEventMotion(cue);
    const timer = setTimeout(() => setEventMotion(""), 460);
    return () => clearTimeout(timer);
  }, [agent.snapshot.status, setEventMotion]);

  return (
    <main
      className={
        "otto-shell relative w-full h-full overflow-hidden bg-otto-surface text-otto-text " +
        (expanded ? "is-expanded " : "") +
        (reducedMotion ? "is-reduced " : "") +
        eventMotion
      }
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onKeyDown={handleEscape}
      onPointerDown={() => {
        if (expanded && !pinned) setPinned(true);
      }}
    >
      {!expanded ? (
        isAgent ? (
          <AgentCapsule
            snapshot={agent.snapshot}
            installed={agent.installed}
            buttonRef={compactButton}
            onOpen={() => open("agent")}
          />
        ) : (
          <button
            ref={compactButton}
            className="otto-compact flex items-center justify-center w-full h-full bg-transparent text-left"
            type="button"
            onClick={() => open("home")}
          >
            <Eyes expression={prefs.expression} reactive={prefs.reactive} />
            <VisuallyHidden>Open Otto</VisuallyHidden>
          </button>
        )
      ) : page === "home" ? (
        <section className="otto-home flex h-full flex-col gap-[10px]">
          <header className="otto-home-head flex h-6 shrink-0 items-center gap-2">
            <button
              className="otto-eye-button grid shrink-0 place-items-center"
              type="button"
              onClick={collapse}
            >
              <Eyes expression={prefs.expression} />
              <VisuallyHidden>Collapse Otto</VisuallyHidden>
            </button>
            <strong>Otto</strong>
            <span className="otto-home-notice" role="status">
              {notice}
            </span>
            <IconButton
              icon="settings"
              label="Open Otto settings"
              ref={homeGear}
              className="otto-gear grid shrink-0 place-items-center"
              onClick={() => open("global-settings")}
            />
          </header>
          <div className="otto-cards grid min-h-0 flex-1 grid-cols-3 gap-[9px]">
            <HomeCard
              name="Agent"
              subtitle="Ask your CLI"
              artwork={agentArt}
              {...artProps}
              onClick={() => open("agent")}
            />
            <HomeCard
              name="Music"
              subtitle="Playback"
              artwork={musicArt}
              {...artProps}
              onClick={() => setNotice("Music is not available yet.")}
            />
            <HomeCard
              name="Focus"
              subtitle="Pomodoro"
              artwork={focusArt}
              {...artProps}
              onClick={() => setNotice("Focus is not available yet.")}
            />
          </div>
        </section>
      ) : page === "global-settings" ? (
        <GlobalSettings prefs={prefs} change={change} onBack={back} />
      ) : (
        <AgentPanel
          agent={agent}
          settings={page === "agent-settings"}
          onSettings={() => open("agent-settings")}
          onSettingsBack={() => setPage("agent")}
          onBack={() => open("home")}
          onCollapse={collapse}
        />
      )}
    </main>
  );
}
