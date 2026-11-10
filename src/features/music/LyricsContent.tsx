import type { ReactNode } from "react";
import type { MediaSnapshot } from "../../platform/tauri/media";
import { Button, Icon, Text } from "../../shared/ui";
import type { LyricLine } from "./lyrics-model";
import type { LyricsController } from "./useLyrics";

function LyricsMessage({
  title,
  children,
  action,
  icon,
  role = "status",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: boolean;
  role?: "status" | "alert";
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center"
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      {icon && (
        <span className="grid h-7 w-7 place-items-center rounded-full bg-otto-control text-otto-text-secondary">
          <Icon name="unavailable" size={15} />
        </span>
      )}
      <Text as="strong" variant="meta" className="text-otto-text-bright">
        {title}
      </Text>
      {children && (
        <Text as="p" variant="caption" className="m-0 max-w-[240px] text-otto-text-tertiary">
          {children}
        </Text>
      )}
      {action}
    </div>
  );
}

function lyricsErrorCopy(error: string) {
  const normalized = error.toLowerCase();
  if (normalized.includes("rate limited")) {
    return {
      title: "Lyrics temporarily unavailable",
      detail: "The lyrics source is busy. Try again in a moment.",
    };
  }
  if (
    normalized.includes("could not be reached") ||
    normalized.includes("timed out") ||
    normalized.includes("interrupted")
  ) {
    return {
      title: "Lyrics source unavailable",
      detail: "The track is still playing. Check your connection and try again.",
    };
  }
  return {
    title: "Lyrics unavailable",
    detail: "The track is playing, but Otto could not verify a matching lyrics result.",
  };
}

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
      <LyricsMessage title="Looking up lyrics…">
        Checking for a verified match for this track.
      </LyricsMessage>
    );
  if (lyrics.error) {
    const copy = lyricsErrorCopy(lyrics.error);
    return (
      <LyricsMessage
        title={copy.title}
        icon
        role="alert"
        action={
          <Button size="xs" onClick={lyrics.retry}>
            Try again
          </Button>
        }
      >
        {copy.detail}
      </LyricsMessage>
    );
  }
  if (lyrics.status === "missing")
    return (
      <LyricsMessage
        title="Lyrics not found"
        icon
        action={
          <Button size="xs" onClick={lyrics.retry}>
            Try again
          </Button>
        }
      >
        This track is playing, but no compatible lyrics were returned.
      </LyricsMessage>
    );
  if (lyrics.record?.instrumental)
    return <LyricsMessage title="Instrumental">This track has no lyrics to display.</LyricsMessage>;
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
          className="otto-lyrics-line"
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
