import type { MediaCommand, MediaSnapshot } from "../../platform/tauri/media";
import { Button, Icon, IconButton, StatusMessage, Text, VisuallyHidden } from "../../shared/ui";
import { mediaDetail, mediaTitle } from "./view";

function Artwork({ snapshot }: { snapshot: MediaSnapshot }) {
  return (
    <span className="grid h-[54px] w-[54px] shrink-0 place-items-center overflow-hidden rounded-full bg-otto-compact-icon text-otto-text-bright">
      {snapshot.artworkDataUrl ? (
        <img
          className="h-full w-full object-cover"
          src={snapshot.artworkDataUrl}
          alt=""
          draggable={false}
        />
      ) : (
        <Icon name="music" size={22} />
      )}
    </span>
  );
}

function PlaybackControls({
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

function SeekBar({
  snapshot,
  busy,
  onControl,
}: {
  snapshot: MediaSnapshot;
  busy: boolean;
  onControl: (command: MediaCommand, positionMs: number) => Promise<void>;
}) {
  const minimum = snapshot.minSeekMs ?? 0;
  const maximum = snapshot.maxSeekMs ?? snapshot.durationMs ?? 0;
  if (!snapshot.controls.seek || maximum <= minimum) return null;
  const value = Math.min(Math.max(snapshot.positionMs ?? minimum, minimum), maximum);
  return (
    <div className="mt-2 flex items-center gap-2">
      <VisuallyHidden htmlFor="otto-media-position">Playback position</VisuallyHidden>
      <input
        id="otto-media-position"
        className="h-1 min-w-0 flex-1 accent-otto-text-bright"
        type="range"
        min={minimum}
        max={maximum}
        value={value}
        disabled={busy}
        onChange={(event) => void onControl("seek", Number(event.currentTarget.value))}
      />
      <Text as="span" variant="caption" className="w-8 text-right text-otto-text-tertiary">
        {Math.round((value / maximum) * 100)}%
      </Text>
    </div>
  );
}

export function MusicPanel({
  snapshot,
  error,
  busy,
  onBack,
  onRefresh,
  onControl,
  motionClass = "",
}: {
  snapshot: MediaSnapshot;
  error: string | null;
  busy: boolean;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onControl: (command: MediaCommand, positionMs?: number) => Promise<void>;
  motionClass?: string;
}) {
  const available = snapshot.status === "available";
  return (
    <section
      className={`flex h-full min-h-0 flex-col px-4 py-3 ${motionClass}`}
      data-surface="music"
    >
      <header className="flex h-7 shrink-0 items-center gap-2">
        <IconButton icon="back" label="Back to Home" variant="quiet" onClick={onBack} />
        <Text as="h1" variant="title" className="text-otto-text-bright">
          Music
        </Text>
        <Text as="span" variant="caption" className="text-otto-text-tertiary">
          System media
        </Text>
        <Button
          className="ml-auto"
          variant="quiet"
          size="link"
          disabled
          title="Lyrics need a source."
        >
          Lyrics
        </Button>
      </header>
      {available ? (
        <main className="mt-3 min-h-0 flex-1">
          <div className="flex items-center gap-3">
            <Artwork snapshot={snapshot} />
            <div className="min-w-0 flex-1">
              <Text
                as="strong"
                variant="title"
                className="block overflow-hidden text-ellipsis whitespace-nowrap text-otto-text-bright"
              >
                {mediaTitle(snapshot)}
              </Text>
              <Text
                as="span"
                variant="meta"
                className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-otto-text-secondary"
              >
                {mediaDetail(snapshot)}
              </Text>
              <Text as="span" variant="caption" className="mt-1 block text-otto-text-tertiary">
                Lyrics unavailable without a source
              </Text>
            </div>
            <PlaybackControls snapshot={snapshot} busy={busy} onControl={onControl} />
          </div>
          <SeekBar snapshot={snapshot} busy={busy} onControl={onControl} />
        </main>
      ) : (
        <main className="mt-3 flex min-h-0 flex-1 items-center">
          <StatusMessage
            title={mediaTitle(snapshot)}
            action={{ label: "Retry", onClick: () => void onRefresh(), disabled: busy }}
          >
            {mediaDetail(snapshot)}
          </StatusMessage>
        </main>
      )}
      {error && (
        <StatusMessage className="mt-2" tone="error" title="Music update failed">
          {error}
        </StatusMessage>
      )}
    </section>
  );
}
