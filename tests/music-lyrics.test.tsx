import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import type { LyricsResult, MediaSnapshot } from "../src/platform/tauri";

let requests: Array<{ resolve: (value: LyricsResult) => void; reject: (error: Error) => void }> = [];
let permission = false;
mock.module("../src/platform/tauri/media", () => ({
  setOnlineLyrics: async (enabled: boolean) => { permission = enabled; },
  getMediaLyrics: () => new Promise<LyricsResult>((resolve, reject) => requests.push({ resolve, reject })),
}));
const { useLyrics } = await import("../src/features/music/useLyrics");
const { trackKey, parseLyrics, playbackPosition } = await import("../src/features/music/lyrics-model");
const snapshot: MediaSnapshot = { seq: 1, status: "available", playback: "playing", title: "Orbit", artist: "Otto", album: "Signals", artworkDataUrl: null, durationMs: 232000, positionMs: 1000, controls: { toggle: true, seek: true, previous: false, next: false }, minSeekMs: 0, maxSeekMs: 232000, message: "Connected" };
const { MusicPanel } = await import("../src/features/music/MusicPanel");
const { useNotchShell } = await import("../src/features/shell/useNotchShell");
const record = { trackName: "Orbit", artistName: "Otto", albumName: "Signals", duration: 232, instrumental: false, plainLyrics: "Words", syncedLyrics: "[00:01]Words" };

afterEach(() => { cleanup(); requests = []; permission = false; });
afterAll(() => mock.restore());

test("lyrics send no lookup before explicit consent and discard old-track results", async () => {
  const { result, rerender } = renderHook(({ media }) => useLyrics(media), { initialProps: { media: snapshot } });
  expect(requests).toHaveLength(0);
  await act(async () => { await result.current.enable(); });
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(permission).toBe(true);
  const next = { ...snapshot, title: "Next" };
  rerender({ media: next });
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { requests[0].resolve({ key: trackKey(snapshot), record }); });
  expect(result.current.record).toBeNull();
  await act(async () => { requests[1].resolve({ key: trackKey(next), record: { ...record, trackName: "Next" } }); });
  await waitFor(() => expect(result.current.record?.trackName).toBe("Next"));
  await act(async () => { await result.current.disable(); });
  expect(result.current.record).toBeNull();
  expect(permission).toBe(false);
});

test("lyrics failure remains recoverable and disabling ignores pending results", async () => {
  const { result } = renderHook(() => useLyrics(snapshot));
  await act(async () => { await result.current.enable(); });
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { requests[0].reject(new Error("Offline")); });
  await waitFor(() => expect(result.current.error).toBe("Offline"));
  act(() => result.current.retry());
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { await result.current.disable(); requests[1].resolve({ key: trackKey(snapshot), record }); });
  expect(result.current.record).toBeNull();
  expect(result.current.status).toBe("off");
});

test("lyrics journey enables online lookup, follows lines, seeks only supported timestamps and returns to Player", async () => {
  const seeking: number[] = [];
  const view = render(<NavigationPlayer media={snapshot} onControl={async (_, position) => { if (position != null) seeking.push(position); }} />);
  fireEvent.click(view.getByRole("button", { name: "Open Music" }));
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  fireEvent.click(view.getByRole("button", { name: "Enable online lyrics" }));
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
  fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
  const enable = view.getByRole("button", { name: "Enable online lyrics" });
  act(() => enable.focus());
  fireEvent.click(enable);
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

test("online permission remains revocable after the media session disappears", async () => {
  const view = render(<NavigationPlayer media={snapshot} />);
  await enableFromKeyboard(view);
  const absent = { ...snapshot, seq: 2, status: "unavailable" as const, title: null, artist: null, album: null };
  view.rerender(<NavigationPlayer media={absent} />);
  expect(permission).toBe(true);
  expect(view.queryByRole("button", { name: "Disable online lyrics" }) !== null).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Disable online lyrics" }));
  await waitFor(() => expect(permission).toBe(false));
  view.rerender(<NavigationPlayer media={{ ...snapshot, seq: 3, title: "Next" }} />);
  expect(requests).toHaveLength(1);
});

test("consent completion restores focus and body-targeted Escape returns to Player before collapse", async () => {
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

test("LRC handles multiple timestamps and invalid timestamps without inventing timing", () => {
  expect(parseLyrics("[00:02.25][00:04]Repeat\n[00:01.100]First\n[00:99]Invalid\nPlain")).toEqual([{ timeMs: 1100, text: "First" }, { timeMs: 2250, text: "Repeat" }, { timeMs: 4000, text: "Repeat" }]);
  expect(parseLyrics("Unsynced words")).toEqual([]);
  expect(playbackPosition({ ...snapshot, observedAtMs: 10000 }, 12000)).toBe(3000);
  expect(playbackPosition({ ...snapshot, observedAtMs: 10000, playback: "paused" }, 12000)).toBe(1000);
  expect(playbackPosition({ ...snapshot, observedAtMs: 10000 }, 999999)).toBe(232000);
});
