import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import type { MediaSnapshot, MediaSubscription } from "../src/platform/tauri";

const initial: MediaSnapshot = {
  seq: 1, status: "available", playback: "paused", title: "Orbit", artist: "Otto",
  sourceId: "player-a", album: "Signals", artworkDataUrl: null, positionMs: 1000,
  durationMs: 232000, minSeekMs: 0, maxSeekMs: 232000,
  controls: { toggle: true, previous: true, next: true, seek: true }, message: "Connected",
};
let observed = initial;
let refresh: () => Promise<MediaSnapshot> = async () => observed;
let attempts = 0;
let releases = 0;
let callbacks: Array<(snapshot: MediaSnapshot) => void> = [];
let subscribe: (callback: (snapshot: MediaSnapshot) => void) => Promise<MediaSubscription>;
const commands: unknown[][] = [];
mock.module("../src/platform/tauri/media", () => ({
  nativeAvailable: true,
  getMediaSnapshot: async () => observed,
  refreshMedia: async () => refresh(),
  subscribeMedia: async (callback: (snapshot: MediaSnapshot) => void) => {
    attempts += 1;
    callbacks.push(callback);
    return subscribe(callback);
  },
  controlMedia: async (...args: unknown[]) => { commands.push(args); return initial; },
  setOnlineLyrics: async () => {},
  getMediaLyrics: async () => ({ key: "", record: null }),
}));
const { useMusic } = await import("../src/features/music/useMusic");
const { MusicPanel } = await import("../src/features/music/MusicPanel");

function Player() {
  const music = useMusic();
  return <MusicPanel music={music} onBack={() => {}} />;
}

function connected() {
  return Promise.resolve({ unsubscribe: async () => { releases += 1; } });
}

afterEach(() => { cleanup(); observed = initial; refresh = async () => observed; attempts = 0; releases = 0; callbacks = []; commands.length = 0; });
afterAll(() => mock.restore());

test("Retry Music restores live updates after subscription failure without duplicate subscriptions", async () => {
  subscribe = async () => { throw new Error("Live updates disconnected"); };
  const view = render(<Player />);
  await waitFor(() => expect(view.getByText(/Live updates disconnected/)).toBeTruthy());
  expect(view.getByText("Orbit")).toBeTruthy();
  act(() => callbacks[0]({ ...initial, seq: 99, title: "Failed connection" }));
  expect(view.queryByText("Failed connection")).toBeNull();
  subscribe = connected;
  fireEvent.click(view.getByRole("button", { name: "Retry Music" }));
  await waitFor(() => expect(attempts).toBe(2));
  await waitFor(() => expect(view.queryByText(/Live updates disconnected/)).toBeNull());
  act(() => callbacks[1]({ ...initial, seq: 2, title: "New orbit", playback: "playing" }));
  await waitFor(() => expect(view.getByText("New orbit")).toBeTruthy());
  act(() => callbacks[0]({ ...initial, seq: 99, title: "Stale connection" }));
  expect(view.queryByText("Stale connection")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Pause media" }));
  expect(attempts).toBe(2);
  view.unmount();
  await waitFor(() => expect(releases).toBe(1));
});

test("standby Check again exposes pending work and renders only the returned session", async () => {
  observed = { ...initial, status: "unavailable", title: null, artist: null };
  subscribe = connected;
  let finish: (snapshot: MediaSnapshot) => void = () => {};
  refresh = () => new Promise(resolve => { finish = resolve; });
  const view = render(<Player />);
  await waitFor(() => expect(view.getByRole("heading", { name: "Play something to get started" })).toBeTruthy());
  const check = view.getByRole("button", { name: "Check again" });
  act(() => check.focus());
  fireEvent.click(check);
  await waitFor(() => expect(view.getByRole("button", { name: "Checking media…" }).hasAttribute("disabled")).toBe(true));
  expect(view.queryByText("Orbit")).toBeNull();
  expect(view.getByRole("button", { name: "Lyrics" }).hasAttribute("disabled")).toBe(true);
  await act(async () => { finish({ ...initial, seq: 2 }); });
  await waitFor(() => expect(view.getByText("Orbit")).toBeTruthy());
  expect(view.queryByRole("button", { name: "Check again" })).toBeNull();
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Lyrics" }));
});

test("a session arriving in the background does not move focus into Music", async () => {
  observed = { ...initial, status: "unavailable", title: null, artist: null };
  subscribe = connected;
  const view = render(<><input /><Player /></>);
  await waitFor(() => expect(view.getByRole("button", { name: "Check again" })).toBeTruthy());
  const outside = view.getByRole("textbox");
  act(() => outside.focus());
  act(() => callbacks[0]({ ...initial, seq: 2 }));
  await waitFor(() => expect(view.getByText("Orbit")).toBeTruthy());
  expect(document.activeElement).toBe(outside);
});

test("a failed standby check offers one recovery action and a repeated empty result stays standby", async () => {
  observed = { ...initial, status: "unavailable", title: null, artist: null };
  subscribe = connected;
  const view = render(<Player />);
  await waitFor(() => expect(view.getByRole("button", { name: "Check again" })).toBeTruthy());
  refresh = async () => { throw new Error("Media connection interrupted"); };
  fireEvent.click(view.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(view.getByText("Couldn’t update Music")).toBeTruthy());
  expect(view.getByText(/Media connection interrupted/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Check again" })).toBeNull();
  expect(view.getAllByRole("button", { name: "Retry Music" })).toHaveLength(1);
  refresh = async () => ({ ...observed, seq: 2 });
  fireEvent.click(view.getByRole("button", { name: "Retry Music" }));
  await waitFor(() => expect(view.getByRole("heading", { name: "Play something to get started" })).toBeTruthy());
  expect(view.queryByText(/Media connection interrupted/)).toBeNull();
  expect(view.queryByText("Orbit")).toBeNull();
});

test("playback commands carry the displayed track identity rather than a later observation", async () => {
  subscribe = connected;
  const { result } = renderHook(() => useMusic());
  await waitFor(() => expect(result.current.snapshot.title).toBe("Orbit"));
  const oldControl = result.current.control;
  act(() => callbacks[0]({ ...initial, seq: 2, title: "New orbit", sourceId: "player-b" }));
  await act(async () => { await oldControl("seek", 4000); });
  expect(commands[0]).toEqual(["seek", JSON.stringify(["player-a", "Orbit", "Otto", "Signals", 232000, null]), 4000]);
});

test("a successful snapshot refresh cannot hide a still-failed live subscription", async () => {
  subscribe = async () => { throw new Error("Live updates disconnected"); };
  const { result } = renderHook(() => useMusic());
  await waitFor(() => expect(result.current.error).toBe("Live updates disconnected"));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.error).toBe("Live updates disconnected");
  expect(result.current.snapshot.title).toBe("Orbit");
  expect(attempts).toBe(2);
});

test("pending subscription ownership is released after unmount and simultaneous retries share one connection", async () => {
  let finish: (value: MediaSubscription) => void = () => {};
  subscribe = () => new Promise((resolve) => { finish = resolve; });
  const { result, unmount } = renderHook(() => useMusic());
  await waitFor(() => expect(attempts).toBe(1));
  let first: Promise<void>;
  let second: Promise<void>;
  act(() => { first = result.current.refresh(); second = result.current.refresh(); });
  expect(attempts).toBe(1);
  unmount();
  await act(async () => { finish(await connected()); await Promise.all([first!, second!]); });
  expect(releases).toBe(1);
});
