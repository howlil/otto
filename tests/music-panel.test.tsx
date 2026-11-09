import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MusicPanel } from "../src/features/music";
import type { MediaSnapshot } from "../src/platform/tauri";

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
  const view = render(
    <MusicPanel
      snapshot={snapshot}
      error={null}
      busy={false}
      onBack={() => {}}
      onRefresh={async () => {
        refreshed += 1;
      }}
      onControl={onControl}
    />,
  );
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
