import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaCommand, MediaSnapshot } from "../../platform/tauri/media";
import { Button, IconButton, Text, useTransitionActive } from "../../shared/ui";
import { LyricsContent } from "./LyricsContent";
import { Artwork } from "./MusicPlayback";
import { parseLyrics } from "./lyrics-model";
import type { LyricsController } from "./useLyrics";
import { mediaDetail, mediaTitle } from "./view";

export function MusicLyrics({
  snapshot,
  lyrics,
  position,
  busy,
  onControl,
  onRestoreFocus,
}: {
  snapshot: MediaSnapshot;
  lyrics: LyricsController;
  position: number;
  busy: boolean;
  onControl: (command: MediaCommand, positionMs?: number) => Promise<void>;
  onRestoreFocus: () => void;
}) {
  const visible = useTransitionActive();
  useEffect(() => (visible ? lyrics.observe() : undefined), [visible, lyrics.observe]);
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLElement>(null);
  const lines = useMemo(() => parseLyrics(lyrics.record?.syncedLyrics ?? null), [lyrics.record]);
  const active = lines.reduce(
    (current, line, index) =>
      snapshot.positionMs != null && line.timeMs <= position ? index : current,
    -1,
  );
  useEffect(() => {
    if (follow && active >= 0)
      list.current
        ?.querySelector("[aria-current='true']")
        ?.scrollIntoView?.({ block: "center", behavior: "instant" });
  }, [active, follow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 pt-1">
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_3fr] gap-3">
        <div className="min-w-0">
          <Artwork snapshot={snapshot} lyrics />
          <Text as="strong" variant="meta" className="mt-1 block truncate">
            {mediaTitle(snapshot)}
          </Text>
          <Text as="span" variant="caption" className="block truncate text-otto-text-tertiary">
            {mediaDetail(snapshot)}
          </Text>
        </div>
        <div className="relative min-h-0 min-w-0">
          <section
            ref={list}
            aria-labelledby="otto-music-title"
            className="h-full overflow-y-auto overscroll-contain [scrollbar-width:none]"
            onWheel={() => setFollow(false)}
            onPointerDown={() => setFollow(false)}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key))
                setFollow(false);
            }}
          >
            <LyricsContent
              lyrics={lyrics}
              lines={lines}
              active={active}
              snapshot={snapshot}
              busy={busy}
              onSeek={(time) => {
                setFollow(true);
                void onControl("seek", time);
              }}
            />
          </section>
          {!follow && lines.length > 0 && (
            <Button
              className="absolute right-1 bottom-0"
              size="xs"
              onClick={() => {
                onRestoreFocus();
                setFollow(true);
              }}
            >
              Follow
            </Button>
          )}
        </div>
      </div>
      <div className="flex min-h-6 shrink-0 items-center gap-2 text-otto-text-tertiary">
        {(lyrics.error || lyrics.status === "missing") && (
          <Button size="link" onClick={lyrics.retry}>
            Retry lyrics
          </Button>
        )}
        <IconButton
          className="ml-auto"
          variant="round"
          icon={snapshot.playback === "playing" ? "pause" : "play"}
          label={snapshot.playback === "playing" ? "Pause media" : "Play media"}
          disabled={busy || !snapshot.controls.toggle}
          onClick={() => void onControl("toggle")}
        />
      </div>
    </div>
  );
}
