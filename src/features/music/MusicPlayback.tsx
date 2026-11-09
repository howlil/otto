import { useRef, useState } from "react";
import type { MediaCommand, MediaSnapshot } from "../../platform/tauri/media";
import { Icon, IconButton, Text, VisuallyHidden } from "../../shared/ui";
import { formatPlaybackTime } from "./lyrics-model";

export function Artwork({
  snapshot,
  lyrics = false,
}: {
  snapshot: MediaSnapshot;
  lyrics?: boolean;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-otto-control bg-otto-compact-icon text-otto-text-bright ${lyrics ? "h-20 w-20" : "h-[68px] w-[68px]"}`}
    >
      {snapshot.artworkDataUrl ? (
        <img
          className="h-full w-full object-cover"
          src={snapshot.artworkDataUrl}
          alt=""
          draggable={false}
        />
      ) : (
        <Icon name="music" size={24} />
      )}
    </span>
  );
}

export function PlaybackControls({
  snapshot,
  busy,
  onControl,
}: {
  snapshot: MediaSnapshot;
  busy: boolean;
  onControl: (command: MediaCommand) => Promise<void>;
}) {
  const playing = snapshot.playback === "playing";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton
        icon="previous"
        label="Previous track"
        variant="round"
        disabled={busy || !snapshot.controls.previous}
        onClick={() => void onControl("previous")}
      />
      <IconButton
        icon={playing ? "pause" : "play"}
        label={playing ? "Pause media" : "Play media"}
        variant="primary"
        disabled={busy || !snapshot.controls.toggle}
        onClick={() => void onControl("toggle")}
      />
      <IconButton
        icon="next"
        label="Next track"
        variant="round"
        disabled={busy || !snapshot.controls.next}
        onClick={() => void onControl("next")}
      />
    </div>
  );
}

export function SeekBar({
  snapshot,
  position,
  busy,
  onControl,
}: {
  snapshot: MediaSnapshot;
  position: number;
  busy: boolean;
  onControl: (command: MediaCommand, positionMs: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const dirty = useRef(false);
  const minimum = snapshot.minSeekMs ?? 0;
  const maximum = snapshot.maxSeekMs ?? snapshot.durationMs ?? 0;
  const canSeek = snapshot.controls.seek && maximum > minimum;
  const commit = async (value: number) => {
    if (!dirty.current || !canSeek || busy) return;
    dirty.current = false;
    try {
      await onControl("seek", value);
    } finally {
      setDraft(null);
    }
  };
  return (
    <div className="flex min-h-7 items-center gap-2 px-1">
      <Text as="span" variant="caption" className="min-w-8 text-otto-text-tertiary tabular-nums">
        {formatPlaybackTime(draft ?? position)}
      </Text>
      <VisuallyHidden htmlFor="otto-media-position">Playback position</VisuallyHidden>
      <input
        id="otto-media-position"
        className="h-1 min-w-0 flex-1 accent-otto-text-bright"
        type="range"
        min={minimum}
        max={Math.max(minimum, maximum)}
        value={Math.min(Math.max(draft ?? position, minimum), Math.max(minimum, maximum))}
        disabled={busy || !canSeek}
        title={canSeek ? "Seek in track" : "This player does not support seeking"}
        onChange={(event) => {
          dirty.current = true;
          setDraft(Number(event.currentTarget.value));
        }}
        onPointerUp={(event) => void commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(event.key)
          )
            void commit(Number(event.currentTarget.value));
        }}
        onBlur={(event) => void commit(Number(event.currentTarget.value))}
      />
      <Text
        as="span"
        variant="caption"
        className="min-w-8 text-right text-otto-text-tertiary tabular-nums"
      >
        {snapshot.durationMs == null ? "--:--" : formatPlaybackTime(snapshot.durationMs)}
      </Text>
    </div>
  );
}
