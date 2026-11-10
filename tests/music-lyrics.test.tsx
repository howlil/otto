import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import { TransitionContent } from "../src/shared/ui/TransitionContent";
import type { LyricsResult, MediaSnapshot } from "../src/platform/tauri";

let requests: Array<{ resolve: (value: LyricsResult) => void; reject: (error: Error) => void }> = [];
let permission = false;
let grant: () => Promise<void> = async () => {};
mock.module("../src/platform/tauri/media", () => ({
  setOnlineLyrics: async (enabled: boolean) => { if (enabled) await grant(); permission = enabled; },
  getMediaLyrics: () => new Promise<LyricsResult>((resolve, reject) => requests.push({ resolve, reject })),
}));
const { useLyrics } = await import("../src/features/music/useLyrics");
const { trackKey, parseLyrics, playbackPosition } = await import("../src/features/music/lyrics-model");
const snapshot: MediaSnapshot = { seq: 1, status: "available", playback: "playing", title: "Orbit", artist: "Otto", album: "Signals", artworkDataUrl: null, durationMs: 232000, positionMs: 1000, controls: { toggle: true, seek: true, previous: false, next: false }, minSeekMs: 0, maxSeekMs: 232000, message: "Connected" };
const { MusicPanel } = await import("../src/features/music/MusicPanel");
const { useNotchShell } = await import("../src/features/shell/useNotchShell");
const record = { trackName: "Orbit", artistName: "Otto", albumName: "Signals", duration: 232, instrumental: false, plainLyrics: "Words", syncedLyrics: "[00:01]Words" };

afterEach(async () => { cleanup(); await act(async () => {}); requests = []; permission = false; grant = async () => {}; });
afterAll(() => mock.restore());

test("lyrics wait for their visible view, update tracks automatically and discard stale results", async () => {
  const view = render(<NavigationPlayer media={snapshot} />);
  expect(requests).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  expect(requests).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(permission).toBe(true);
  const next = { ...snapshot, title: "Next" };
  view.rerender(<NavigationPlayer media={next} />);
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { requests[0].resolve({ key: trackKey(snapshot), record }); });
  expect(view.queryByRole("button", { name: "Words" })).toBeNull();
  await act(async () => { requests[1].resolve({ key: trackKey(next), record: { ...record, trackName: "Next", syncedLyrics: "[00:01]Next words" } }); });
  await waitFor(() => expect(view.getByRole("button", { name: "Next words" })).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Player" }));
  await waitFor(() => expect(permission).toBe(false));
  view.rerender(<NavigationPlayer media={{ ...next, title: "Hidden track" }} />);
  expect(requests).toHaveLength(2);
});

test("lyrics failure remains recoverable and closing ignores pending results", async () => {
  const view = render(<NavigationPlayer media={snapshot} />);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { requests[0].reject(new Error("Offline")); });
  await waitFor(() => expect(view.getByText("Offline")).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Retry lyrics" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  fireEvent.click(view.getByRole("button", { name: "Player" }));
  await act(async () => { requests[1].resolve({ key: trackKey(snapshot), record }); });
  expect(view.queryByRole("button", { name: "Words" })).toBeNull();
  expect(view.getByRole("button", { name: "Lyrics" })).toBeTruthy();
  await waitFor(() => expect(permission).toBe(false));
});

test("lyrics journey automatically looks up lyrics, follows lines, seeks only supported timestamps and returns to Player", async () => {
  const seeking: number[] = [];
  const view = render(<NavigationPlayer media={snapshot} onControl={async (_, position) => { if (position != null) seeking.push(position); }} />);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  expect(view.queryByRole("button", { name: "Enable online lyrics" })).toBeNull();
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { requests[0].resolve({ key: trackKey(snapshot), record: { ...record, syncedLyrics: "[00:00]First\n[00:02]Second\n[99:00]Out of range" } }); });
  await waitFor(() => expect(view.getByRole("button", { name: "First" }).getAttribute("aria-current")).toBe("true"));
  expect(view.getByRole("button", { name: "Out of range" }).hasAttribute("disabled")).toBe(true);
  fireEvent.wheel(view.getByRole("button", { name: "Second" }).parentElement!);
  expect(view.getByRole("button", { name: "Follow" })).toBeTruthy();
  act(() => view.getByRole("button", { name: "Follow" }).focus());
  fireEvent.click(view.getByRole("button", { name: "Follow" }));
  expect(document.activeElement === view.getByRole("button", { name: "Player" })).toBe(true);
  expect(view.queryByRole("button", { name: "Follow" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Second" }));
  expect(seeking).toEqual([2000]);
  fireEvent.keyDown(view.container.querySelector("section")!, { key: "Escape" });
  expect(view.getByRole("button", { name: "Lyrics" })).toBeTruthy();
  expect(view.queryByText("Second")).toBeNull();
});

function NavigationPlayer({ media, onControl = async () => {}, busy = false }: { media: MediaSnapshot; onControl?: (command: string, position?: number) => Promise<void>; busy?: boolean }) {
  const lyrics = useLyrics(media);
  const consumeEscape = useCallback((page: string) => {
    if (page !== "music" || !lyrics.open) return false;
    lyrics.setOpen(false);
    return true;
  }, [lyrics.open, lyrics.setOpen]);
  const shell = useNotchShell(consumeEscape);
  return <>
    <button type="button" onClick={() => shell.open("music")}>Open Music</button>
    <button type="button" onClick={() => shell.open("agent")}>Open Agent</button>
    <output data-testid="shell-mode">{shell.expanded ? shell.page : "compact"}</output>
    {shell.expanded && shell.isMusic && <MusicPanel music={{ snapshot: media, lyrics, error: null, busy, refresh: async () => {}, control: onControl }} onBack={() => shell.open("home")} />}
  </>;
}

async function enableFromKeyboard(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  const lyrics = view.getByRole("button", { name: "Lyrics" });
  act(() => lyrics.focus());
  fireEvent.click(lyrics);
  expect(view.queryByRole("button", { name: "Enable online lyrics" })).toBeNull();
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { requests[0].resolve({ key: trackKey(snapshot), record }); });
}

test("Lyrics playback stays in the subview and obeys observed capability and pending state", async () => {
  const controls: string[] = [];
  const onControl = async (command: string) => { controls.push(command); };
  const view = render(<NavigationPlayer media={snapshot} onControl={onControl} />);
  await enableFromKeyboard(view);
  fireEvent.click(view.getByRole("button", { name: "Pause media" }));
  expect(controls).toEqual(["toggle"]);
  expect(view.getByRole("button", { name: "Player" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Words" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Pause media" })).toBeTruthy();
  view.rerender(<NavigationPlayer media={snapshot} onControl={onControl} busy />);
  expect(view.getByRole("button", { name: "Pause media" }).hasAttribute("disabled")).toBe(true);
  const unsupported = { ...snapshot, playback: "paused" as const, controls: { ...snapshot.controls, toggle: false } };
  view.rerender(<NavigationPlayer media={unsupported} onControl={onControl} />);
  expect(view.getByRole("button", { name: "Play media" }).hasAttribute("disabled")).toBe(true);
  expect(controls).toEqual(["toggle"]);
});

test("missing sessions and navigation stop automatic lookups without a disable button", async () => {
  const view = render(<NavigationPlayer media={snapshot} />);
  await enableFromKeyboard(view);
  const absent = { ...snapshot, seq: 2, status: "unavailable" as const, title: null, artist: null, album: null };
  view.rerender(<NavigationPlayer media={absent} />);
  await waitFor(() => expect(permission).toBe(false));
  expect(view.queryByRole("button", { name: "Disable online lyrics" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Open Agent" }));
  view.rerender(<NavigationPlayer media={{ ...snapshot, seq: 3, title: "Next" }} />);
  expect(requests).toHaveLength(1);
});

test("automatic lookup keeps keyboard focus and body-targeted Escape returns to Player before collapse", async () => {
  const view = render(<NavigationPlayer media={snapshot} />);
  await enableFromKeyboard(view);
  expect(document.activeElement === view.getByRole("button", { name: "Player" })).toBe(true);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(view.getByTestId("shell-mode").textContent).toBe("music");
  expect(view.queryByRole("button", { name: "Lyrics" }) !== null).toBe(true);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(view.getByTestId("shell-mode").textContent).toBe("compact");
});

test("Music subview Escape does not intercept navigation on another feature", async () => {
  const view = render(<NavigationPlayer media={snapshot} />);
  await enableFromKeyboard(view);
  fireEvent.click(view.getByRole("button", { name: "Open Agent" }));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(view.getByTestId("shell-mode").textContent).toBe("compact");
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  expect(view.queryByRole("button", { name: "Player" }) !== null).toBe(true);
});

test("a mismatched lookup result is recoverable rather than displaying another track or loading forever", async () => {
  const view = render(<NavigationPlayer media={snapshot} />);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { requests[0].resolve({ key: "other track", record }); });
  expect(view.getByText("The media item changed. Retry lyrics.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Retry lyrics" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Words" })).toBeNull();
});

test("closing before the permission handshake completes cannot start a late lookup", async () => {
  let finish: () => void = () => {};
  grant = () => new Promise(resolve => { finish = resolve; });
  const view = render(<NavigationPlayer media={snapshot} />);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  await act(async () => {});
  fireEvent.click(view.getByRole("button", { name: "Player" }));
  await act(async () => { finish(); });
  expect(requests).toHaveLength(0);
  expect(permission).toBe(false);
});

test.each([
  [null, "No matching lyrics found for this version."],
  [{ ...record, instrumental: true, syncedLyrics: null, plainLyrics: null }, "Instrumental · no lyrics"],
  [{ ...record, syncedLyrics: null, plainLyrics: "Unsynced words" }, "Unsynced words"],
])("missing, instrumental and plain lyrics remain truthful", async (response, text) => {
  const view = render(<NavigationPlayer media={snapshot} />);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { requests[0].resolve({ key: trackKey(snapshot), record: response }); });
  expect(view.getByText(text)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Unsynced words" })).toBeNull();
});

function RetainedLyrics({ shown, media }: { shown: boolean; media: MediaSnapshot }) {
  const lyrics = useLyrics(media);
  return <TransitionContent transitionKey={shown ? "lyrics" : "other"} reducedMotion={false}>
    {shown ? <MusicPanel music={{ snapshot: media, lyrics: { ...lyrics, open: true }, error: null, busy: false, refresh: async () => {}, control: async () => {} }} onBack={() => {}} /> : <span>Other surface</span>}
  </TransitionContent>;
}

test("retained outgoing Lyrics cannot continue automatic metadata lookups", async () => {
  const view = render(<RetainedLyrics shown media={snapshot} />);
  await waitFor(() => expect(requests).toHaveLength(1));
  view.rerender(<RetainedLyrics shown={false} media={snapshot} />);
  await waitFor(() => expect(permission).toBe(false));
  view.rerender(<RetainedLyrics shown={false} media={{ ...snapshot, title: "Other track" }} />);
  await act(async () => { requests[0].resolve({ key: trackKey(snapshot), record }); });
  expect(requests).toHaveLength(1);
  expect(view.getByText("Other surface")).toBeTruthy();
});

test("unknown player position does not fabricate an active synchronized line", async () => {
  const view = render(<NavigationPlayer media={{ ...snapshot, positionMs: null }} />);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  const current = { ...snapshot, positionMs: null };
  await act(async () => { requests[0].resolve({ key: trackKey(current), record: { ...record, syncedLyrics: "[00:00]Words" } }); });
  expect(view.getByRole("button", { name: "Words" }).getAttribute("aria-current")).toBeNull();
});

test("LRC handles multiple timestamps and invalid timestamps without inventing timing", () => {
  expect(parseLyrics("[00:02.25][00:04]Repeat\n[00:01.100]First\n[00:99]Invalid\nPlain")).toEqual([{ timeMs: 1100, text: "First" }, { timeMs: 2250, text: "Repeat" }, { timeMs: 4000, text: "Repeat" }]);
  expect(parseLyrics("Unsynced words")).toEqual([]);
  expect(playbackPosition({ ...snapshot, observedAtMs: 10000 }, 12000)).toBe(3000);
  expect(playbackPosition({ ...snapshot, observedAtMs: 10000, playback: "paused" }, 12000)).toBe(1000);
  expect(playbackPosition({ ...snapshot, observedAtMs: 10000 }, 999999)).toBe(232000);
});
