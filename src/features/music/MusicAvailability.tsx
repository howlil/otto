import type { MediaSnapshot } from "../../platform/tauri/media";
import { Button, Icon, StatusMessage, Text } from "../../shared/ui";
import { mediaDetail, mediaTitle } from "./view";

export function MusicAvailability({
  snapshot,
  error,
  busy,
  onRefresh,
}: {
  snapshot: MediaSnapshot;
  error: string | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
}) {
  if (snapshot.status !== "unavailable" || error) {
    return (
      <main className="flex min-h-0 flex-1 items-center" aria-busy={busy}>
        <StatusMessage
          className="w-full"
          title={error ? "Couldn’t update Music" : mediaTitle(snapshot)}
          action={
            snapshot.status === "loading" && !error
              ? undefined
              : { label: "Retry Music", onClick: () => void onRefresh(), disabled: busy }
          }
        >
          <span id="otto-music-session-hint">
            {error ? `Music update failed: ${error}` : mediaDetail(snapshot)}
          </span>
        </StatusMessage>
      </main>
    );
  }
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 py-3" aria-busy={busy}>
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <span className="grid w-8 shrink-0 place-items-center text-otto-text-secondary">
          <Icon name="music" size={32} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-otto-xl font-medium leading-5 text-otto-text-bright">
            Play something to get started
          </h2>
          <p
            id="otto-music-session-hint"
            className="m-0 mt-1 text-otto-md leading-4 text-otto-text-secondary"
          >
            {snapshot.message ||
              "Start playback in a supported media app. Controls will appear here."}
          </p>
        </div>
      </div>
      <div className="flex min-h-7 shrink-0 items-center gap-2 pl-12">
        <Text
          as="p"
          variant="status"
          className="m-0 min-w-0 flex-1 text-otto-text-secondary"
          role="status"
        >
          {busy ? "Checking system media…" : ""}
        </Text>
        <Button variant="quiet" size="xs" disabled={busy} onClick={() => void onRefresh()}>
          {busy ? "Checking media…" : "Check again"}
        </Button>
      </div>
    </main>
  );
}
