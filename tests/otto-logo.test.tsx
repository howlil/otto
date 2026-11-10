import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { BackControl } from "../src/features/agent/AgentHeaderControls";
import { FocusHeader } from "../src/features/focus/FocusHeader";
import { MusicPanel } from "../src/features/music/MusicPanel";
import { defaults } from "../src/features/shell/preferences";
import { CompactEyesButton } from "../src/ShellSurfaces";

const unavailableMusic = {
  snapshot: {
    seq: 0, status: "unavailable" as const, playback: "unknown" as const,
    title: null, artist: null, artworkDataUrl: null, positionMs: null, durationMs: null,
    minSeekMs: null, maxSeekMs: null,
    controls: { toggle: false, previous: false, next: false, seek: false }, message: "No session",
  },
  lyrics: { open: false, enabled: false, status: "off" as const, record: null, error: null, key: "", setOpen: () => {}, enable: async () => {}, disable: async () => {}, retry: () => {} },
  error: null, busy: false, refresh: async () => {}, control: async () => {},
};

afterEach(cleanup);

for (const module of ["Agent", "Music", "Focus"] as const) {
  test(`${module} retains the Home logo and its Home action without session data`, () => {
    const home = render(<CompactEyesButton expanded prefs={defaults} buttonRef={createRef()} reducedMotion onToggle={() => {}} />);
    const reference = home.container.querySelector("[data-otto-logo]") as HTMLElement;
    const logoClass = reference.className;
    const eyesClass = reference.querySelector("[data-expression]")?.className;
    const eyeClasses = [...reference.querySelectorAll("i")].map((eye) => eye.className);
    home.unmount();
    let returnedHome = 0;
    const onHome = () => { returnedHome += 1; };
    const view = render(module === "Agent" ? (
      <BackControl view="chat" buttonRef={createRef()} onBack={() => {}} onHome={onHome} />
    ) : module === "Music" ? (
      <MusicPanel music={unavailableMusic} onBack={onHome} />
    ) : (
      <FocusHeader snapshot={{ revision: 1, phase: "focus", status: "ready", remainingSeconds: 1500, durations: { focus: 25, short: 5, long: 15 }, completedFocusSessions: 0 }} settings={false} onHome={onHome} onSettings={() => {}} onSettingsBack={() => {}} />
    ));
    const button = view.getByRole("button", { name: module === "Agent" ? "Return to Home" : "Back to Home" });
    const logo = button.querySelector("[data-otto-logo]") as HTMLElement;
    expect(logo).not.toBeNull();
    expect(logo.className).toBe(logoClass);
    expect(logo.querySelector("[data-expression]")?.className).toBe(eyesClass);
    expect([...logo.querySelectorAll("i")].map((eye) => eye.className)).toEqual(eyeClasses);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(returnedHome).toBe(1);
  });
}
