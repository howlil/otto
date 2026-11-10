import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MusicPanel, MusicCapsule } from "../src/features/music";
import { SeekBar } from "../src/features/music/MusicPlayback";
import type { MediaSnapshot } from "../src/platform/tauri";
import { useLyrics } from "../src/features/music/useLyrics";
import { ShellCompactSurface } from "../src/ShellCompactSurface";

afterEach(cleanup);

const unavailable: MediaSnapshot = {
  seq: 1,
  status: "unavailable",
  playback: "unknown",
  title: null,
  artist: null,
  artworkDataUrl: null,
  positionMs: null,
  durationMs: null,
  minSeekMs: null,
  maxSeekMs: null,
  controls: { toggle: false, previous: false, next: false, seek: false },
  message: "Open a supported media app to show playback here.",
};

function renderPanel(snapshot: MediaSnapshot, onControl = async () => {}) {
  let refreshed = 0;
  function Panel() {
    const lyrics = useLyrics(snapshot);
    return <MusicPanel
      music={{ snapshot, lyrics, error: null, busy: false, refresh: async () => { refreshed += 1; }, control: onControl }}
      onBack={() => {}}
    />;
  }
  const view = render(<Panel />);
  return { view, refreshed: () => refreshed };
}

test("the combined shell preserves Compact playback controls without navigation", () => {
  type Props = Parameters<typeof ShellCompactSurface>[0];
  const commands: string[] = [];
  const opened: string[] = [];
  const props = {
    agent: {} as Props["agent"],
    focus: {} as Props["focus"],
    music: {
      snapshot: {
        ...unavailable,
        status: "available",
        playback: "paused",
        controls: { toggle: true, previous: false, next: false, seek: false },
      },
      busy: false,
      control: async (command: string) => { commands.push(command); },
    } as Props["music"],
    shell: {
      isAgent: false,
      isMusic: true,
      page: "music",
      compactButton: { current: null },
      open: (page: string) => { opened.push(page); },
    } as Props["shell"],
    nudgeMotion: "",
    osEvent: null,
  };
  const view = render(<ShellCompactSurface {...props} />);
  fireEvent.click(view.getByRole("button", { name: "Play media" }));
  expect(commands).toEqual(["toggle"]);
  expect(opened).toEqual([]);
  expect(view.getByRole("button", { name: "Play media" })).toBeTruthy();
  view.rerender(<ShellCompactSurface {...props} music={{ ...props.music, busy: true }} />);
  expect(view.getByRole("button", { name: "Play media" }).hasAttribute("disabled")).toBe(true);
});

test("Music standby explains playback, disables Lyrics with a reason and keeps Check again quiet", () => {
  const { view, refreshed } = renderPanel({ ...unavailable, title: "Stale title", artworkDataUrl: "data:image/png;base64,stale" });
  expect(view.getByRole("heading", { name: "Play something to get started" })).toBeTruthy();
  expect(view.getByText(unavailable.message)).toBeTruthy();
  expect(view.queryByText("Stale title")).toBeNull();
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.queryByRole("slider")).toBeNull();
  expect(view.queryByRole("button", { name: "Play media" })).toBeNull();
  const lyrics = view.getByRole("button", { name: "Lyrics" });
  expect(lyrics.hasAttribute("disabled")).toBe(true);
  expect(document.getElementById(lyrics.getAttribute("aria-describedby")!)?.textContent).toBe(unavailable.message);
  fireEvent.click(view.getByRole("button", { name: "Check again" }));
  expect(refreshed()).toBe(1);
});

test("an unavailable observation keeps the native diagnostic visible for recovery", () => {
  const message = "System media session could not be read: session unavailable";
  const { view } = renderPanel({ ...unavailable, message });
  expect(view.getByText(message)).toBeTruthy();
  expect(view.getByRole("button", { name: "Check again" })).toBeTruthy();
});

test("initial detection and unsupported media do not masquerade as an empty session", () => {
  const loading = renderPanel({ ...unavailable, status: "loading", message: "Checking system media." }).view;
  expect(loading.getByText("Checking media")).toBeTruthy();
  expect(loading.queryByRole("button", { name: "Check again" })).toBeNull();
  expect(loading.queryByRole("button", { name: "Retry Music" })).toBeNull();
  loading.unmount();
  const unsupported = renderPanel({ ...unavailable, status: "unsupported", message: "Windows media access is unavailable on this installation." }).view;
  expect(unsupported.getByText("Music unavailable")).toBeTruthy();
  expect(unsupported.getByText("Windows media access is unavailable on this installation.")).toBeTruthy();
  expect(unsupported.queryByRole("heading", { name: "Play something to get started" })).toBeNull();
  expect(unsupported.getByRole("button", { name: "Retry Music" })).toBeTruthy();
});

test("Compact standby keeps an expand action without artwork or unavailable playback controls", () => {
  let opened = false;
  const view = render(<MusicCapsule snapshot={{ ...unavailable, message: "", title: "Stale title", artworkDataUrl: "data:image/png;base64,stale", controls: { toggle: true, seek: false, previous: false, next: false } }} buttonRef={null} busy={false} onOpen={() => { opened = true; }} onToggle={async () => {}} />);
  expect(view.getByText("No active media")).toBeTruthy();
  expect(view.getByText("Start playback in a media app")).toBeTruthy();
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.queryByRole("button", { name: "Play media" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /Open Music/ }));
  expect(opened).toBe(true);
});

test("Music uses icon navigation without source labels and opens lyrics without an enable step", () => {
  const { view } = renderPanel({ ...unavailable, status: "available", title: "Orbit", artist: "Otto" });
  expect(view.queryByText("System media")).toBeNull();
  const lyrics = view.getByRole("button", { name: "Lyrics" });
  expect(lyrics.querySelector("svg")).toBeTruthy();
  fireEvent.click(lyrics);
  expect(view.getByRole("button", { name: "Player" }).querySelector("svg")).toBeTruthy();
  expect(view.queryByText(/LRCLIB|Sends title, artist, album/)).toBeNull();
  expect(view.queryByRole("button", { name: "Enable online lyrics" })).toBeNull();
});

test("Music shows elapsed time and duration instead of a percentage", () => {
  const { view } = renderPanel({ ...unavailable, status: "available", positionMs: 74000, durationMs: 232000, minSeekMs: 0, maxSeekMs: 232000, controls: { toggle: true, previous: false, next: false, seek: true } });
  expect(view.getByText("1:14")).toBeTruthy();
  expect(view.getByText("3:52")).toBeTruthy();
});

test("seek previews a drag locally and submits only its final position", async () => {
  const positions: number[] = [];
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const view = render(<SeekBar snapshot={{ ...unavailable, status: "available", durationMs: 232000, minSeekMs: 0, maxSeekMs: 232000, controls: { toggle: true, seek: true, previous: false, next: false } }} position={1000} busy={false} onControl={async (_, position) => { positions.push(position); await pending; }} />);
  const slider = view.getByRole("slider");
  fireEvent.change(slider, { target: { value: "40000" } });
  fireEvent.change(slider, { target: { value: "74000" } });
  expect(view.getByText("1:14")).toBeTruthy();
  expect(positions).toEqual([]);
  fireEvent.pointerUp(slider);
  expect(positions).toEqual([74000]);
  await act(async () => { finish(); });
  expect(view.getByText("0:01")).toBeTruthy();
});

test("Compact playback does not navigate or fabricate playing state", () => {
  let opened = false;
  let toggled = false;
  const view = render(<MusicCapsule snapshot={{ ...unavailable, status: "available", title: "Orbit", artist: "Otto", playback: "paused", controls: { toggle: true, seek: false, previous: false, next: false } }} buttonRef={null} busy={false} onOpen={() => { opened = true; }} onToggle={async () => { toggled = true; }} />);
  fireEvent.click(view.getByRole("button", { name: "Play media" }));
  expect(toggled).toBe(true);
  expect(opened).toBe(false);
  expect(view.getByRole("button", { name: "Play media" })).toBeTruthy();
});

test("Music only enables the controls reported by the active session", () => {
  const controls: Array<string> = [];
  const { view } = renderPanel(
    {
      ...unavailable,
      status: "available",
      playback: "paused",
      title: "Orbit",
      artist: "Otto",
      controls: { toggle: true, previous: false, next: false, seek: false },
      message: "Connected to system media.",
    },
    async (command) => {
      controls.push(command);
    },
  );

  expect(view.getByRole("button", { name: "Previous track" }).hasAttribute("disabled")).toBe(true);
  expect(view.getByRole("button", { name: "Next track" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Play media" }));
  expect(controls).toEqual(["toggle"]);
});
