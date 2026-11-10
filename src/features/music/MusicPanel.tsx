import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import type { MediaCommand, MediaSnapshot } from "../../platform/tauri/media";
import { Button, IconButton, OttoHomeButton, Text } from "../../shared/ui";
import { MusicAvailability } from "./MusicAvailability";
import { MusicLyrics } from "./MusicLyrics";
import { Artwork, PlaybackControls, SeekBar } from "./MusicPlayback";
import { playbackPosition, trackKey } from "./lyrics-model";
import type { LyricsController } from "./useLyrics";
import { mediaDetail, mediaTitle } from "./view";

function useMusicFocus() {
  const lyricsButton = useRef<HTMLButtonElement>(null);
  const homeButton = useRef<HTMLButtonElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  const restoreFocus = useCallback(() => {
    if (!document.hasFocus()) return;
    const target = lyricsButton.current?.disabled ? homeButton.current : lyricsButton.current;
    target?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (focused.current && !focused.current.isConnected && document.activeElement === document.body)
      restoreFocus();
  });
  return {
    lyricsButton,
    homeButton,
    restoreFocus,
    rememberFocus: (event: FocusEvent<HTMLElement>) => {
      focused.current = event.target;
    },
  };
}

export function MusicPanel({
  music,
  onBack,
  motionClass = "",
}: {
  music: {
    snapshot: MediaSnapshot;
    lyrics: LyricsController;
    error: string | null;
    busy: boolean;
    refresh: () => Promise<void>;
    control: (command: MediaCommand, positionMs?: number) => Promise<void>;
  };
  onBack: () => void;
  motionClass?: string;
}) {
  const { snapshot, lyrics, error, busy, refresh: onRefresh, control: onControl } = music;
  const focus = useMusicFocus();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (snapshot.playback !== "playing") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [snapshot]);
  const available = snapshot.status === "available";
  const lyricsDisabled = !available && !lyrics.open;
  const position = playbackPosition(snapshot, now);
  function renderContent() {
    if (!available)
      return (
        <MusicAvailability snapshot={snapshot} error={error} busy={busy} onRefresh={onRefresh} />
      );
    if (lyrics.open)
      return (
        <MusicLyrics
          key={`lyrics:${trackKey(snapshot)}`}
          snapshot={snapshot}
          lyrics={lyrics}
          position={position}
          busy={busy}
          onControl={onControl}
          onRestoreFocus={focus.restoreFocus}
        />
      );
    return (
      <main className="flex min-h-0 flex-1 items-center gap-3 py-2">
        <Artwork snapshot={snapshot} />
        <div className="min-w-0 flex-1">
          <Text as="strong" variant="heading" className="block truncate text-otto-text-bright">
            {mediaTitle(snapshot)}
          </Text>
          <Text as="span" variant="meta" className="mt-1 block truncate text-otto-text-secondary">
            {mediaDetail(snapshot)}
          </Text>
        </div>
        <PlaybackControls snapshot={snapshot} busy={busy} onControl={onControl} />
      </main>
    );
  }
  return (
    <section
      aria-labelledby="otto-music-title"
      className={`flex h-full min-h-0 flex-col px-4 ${lyrics.open ? "py-1" : "py-2"} ${motionClass}`}
      data-surface={lyrics.open ? "music-lyrics" : "music"}
      onFocusCapture={focus.rememberFocus}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-otto-line-mid pb-1">
        <OttoHomeButton ref={focus.homeButton} onClick={onBack} />
        <Text as="h1" id="otto-music-title" variant="title" className="text-otto-text-bright">
          Music
        </Text>
        <IconButton
          ref={focus.lyricsButton}
          className="ml-auto"
          icon={lyrics.open ? "music" : "lyrics"}
          label={lyrics.open ? "Player" : "Lyrics"}
          disabled={lyricsDisabled}
          aria-describedby={lyricsDisabled ? "otto-music-session-hint" : undefined}
          title={
            lyricsDisabled
              ? "An active media session is required"
              : lyrics.open
                ? "Player"
                : "Lyrics"
          }
          onClick={() => lyrics.setOpen(!lyrics.open)}
        />
      </header>
      {renderContent()}
      {available && (
        <SeekBar
          key={`seek:${trackKey(snapshot)}`}
          snapshot={snapshot}
          position={position}
          busy={busy}
          onControl={onControl}
        />
      )}
      {error && available && (
        <div className="flex shrink-0 items-center gap-2 text-otto-text-secondary">
          <Text as="p" variant="caption" className="min-w-0 flex-1" role="status">
            Music update failed: {error}
          </Text>
          <Button size="link" disabled={busy} onClick={() => void onRefresh()}>
            Retry Music
          </Button>
        </div>
      )}
    </section>
  );
}
