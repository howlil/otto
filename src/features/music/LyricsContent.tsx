import type { MediaSnapshot } from "../../platform/tauri/media";
import { Text } from "../../shared/ui";
import type { LyricLine } from "./lyrics-model";
import type { LyricsController } from "./useLyrics";

export function LyricsContent({
  lyrics,
  lines,
  active,
  snapshot,
  busy,
  onSeek,
}: {
  lyrics: LyricsController;
  lines: LyricLine[];
  active: number;
  snapshot: MediaSnapshot;
  busy: boolean;
  onSeek: (time: number) => void;
}) {
  if (lyrics.status === "loading" || lyrics.status === "off")
    return (
      <Text as="p" variant="meta" role="status">
        Looking up lyrics…
      </Text>
    );
  if (lyrics.error)
    return (
      <Text as="p" variant="meta" role="status">
        {lyrics.error}
      </Text>
    );
  if (lyrics.status === "missing")
    return (
      <Text as="p" variant="meta" role="status">
        No matching lyrics found for this version.
      </Text>
    );
  if (lyrics.record?.instrumental)
    return (
      <Text as="p" variant="meta">
        Instrumental · no lyrics
      </Text>
    );
  if (!lines.length)
    return (
      <Text as="p" variant="meta" className="whitespace-pre-line">
        {lyrics.record?.plainLyrics || "No lyrics text available."}
      </Text>
    );
  return (
    <>
      {lines.map((line, index) => (
        <button
          key={`${line.timeMs}:${line.text}`}
          type="button"
          aria-current={index === active ? "true" : undefined}
          className={`block min-h-6 w-full border-0 bg-transparent py-1 text-left text-otto-sm disabled:cursor-default ${index === active ? "font-medium text-otto-text-bright" : "text-otto-text-tertiary"}`}
          disabled={
            busy ||
            !snapshot.controls.seek ||
            line.timeMs < (snapshot.minSeekMs ?? 0) ||
            line.timeMs > (snapshot.maxSeekMs ?? snapshot.durationMs ?? 0)
          }
          onClick={() => onSeek(line.timeMs)}
        >
          {line.text}
        </button>
      ))}
    </>
  );
}
