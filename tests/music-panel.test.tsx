import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MusicPanel, MusicCapsule } from "../src/features/music";
import { SeekBar } from "../src/features/music/MusicPlayback";
import type { MediaSnapshot } from "../src/platform/tauri";
import { useLyrics } from "../src/features/music/useLyrics";

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

test("Music shows an explicit empty state instead of fabricated track details", () => {
  const { view, refreshed } = renderPanel(unavailable);

  expect(view.getByText("No media session")).toBeTruthy();
  expect(view.getByText(unavailable.message)).toBeTruthy();
  expect(view.queryByText("Media playing")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  expect(refreshed()).toBe(1);
});

test("Music opens lyrics with explicit online consent instead of a disabled dead end", () => {
  const { view } = renderPanel({ ...unavailable, status: "available", title: "Orbit", artist: "Otto" });
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  expect(view.getByText(/title, artist, album and duration/i)).toBeTruthy();
  expect(view.getByRole("button", { name: "Enable online lyrics" })).toBeTruthy();
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
