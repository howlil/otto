import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaCommand, MediaSnapshot } from "../../platform/tauri/media";
import { IconButton, Text, useTransitionActive } from "../../shared/ui";
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
      <div className="otto-lyrics-layout">
        <div className="flex min-w-0 flex-col items-start justify-center">
          <Artwork snapshot={snapshot} lyrics />
          <Text as="strong" variant="meta" className="mt-1 block w-full min-w-0 truncate">
            {mediaTitle(snapshot)}
          </Text>
          <Text
            as="span"
            variant="caption"
            className="block w-full min-w-0 truncate text-otto-text-tertiary"
          >
            {mediaDetail(snapshot)}
          </Text>
        </div>
        <div className="otto-lyrics-pane">
          <section
            ref={list}
            aria-labelledby="otto-music-title"
            className={`otto-lyrics-lines min-h-0 ${!follow && lines.length > 0 ? "otto-lyrics-lines-manual" : ""}`}
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
            <IconButton
              className="absolute right-1 top-1/2 z-[1] -translate-y-1/2"
              variant="outlined"
              icon="chevronDown"
              label="Follow"
              title="Follow current lyric"
              onClick={() => {
                onRestoreFocus();
                setFollow(true);
              }}
            />
          )}
        </div>
      </div>
      <div className="flex min-h-6 shrink-0 items-center gap-2 text-otto-text-tertiary">
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
