import { useCallback, useEffect, useRef, useState } from "react";
import {
  controlMedia,
  getMediaSnapshot,
  nativeAvailable,
  refreshMedia,
  subscribeMedia,
  type MediaCommand,
  type MediaSnapshot,
  type MediaSubscription,
} from "../../platform/tauri/media";

import { useLyrics } from "./useLyrics";

const controls = { toggle: false, previous: false, next: false, seek: false };

function initialSnapshot(): MediaSnapshot {
  return nativeAvailable
    ? {
        seq: 0,
        status: "loading",
        playback: "unknown",
        title: null,
        artist: null,
        artworkDataUrl: null,
        positionMs: null,
        durationMs: null,
        minSeekMs: null,
        maxSeekMs: null,
        controls,
        message: "Checking system media.",
      }
    : {
        seq: 0,
        status: "unsupported",
        playback: "unknown",
        title: null,
        artist: null,
        artworkDataUrl: null,
        positionMs: null,
        durationMs: null,
        minSeekMs: null,
        maxSeekMs: null,
        controls,
        message: "System media is available in Otto on Windows.",
      };
}

function errorMessage(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "System media could not be reached.";
}

export function useMusic() {
  const [snapshot, setSnapshot] = useState<MediaSnapshot>(initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subscription = useRef<MediaSubscription | null>(null);
  const operating = useRef(false);
  const latestSequence = useRef(-1);
  const lyrics = useLyrics(snapshot);
  const receive = useCallback((next: MediaSnapshot) => {
    if (next.seq < latestSequence.current) return;
    latestSequence.current = next.seq;
    setSnapshot(next);
    setError(null);
  }, []);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    void getMediaSnapshot()
      .then((next) => active && receive(next))
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    void subscribeMedia((next) => active && receive(next))
      .then((next) => {
        if (active) subscription.current = next;
        else void next.unsubscribe();
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
      void subscription.current?.unsubscribe();
      subscription.current = null;
    };
  }, [receive]);

  const refresh = useCallback(async () => {
    if (!nativeAvailable || operating.current) return;
    operating.current = true;
    setBusy(true);
    try {
      receive(await refreshMedia());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      operating.current = false;
      setBusy(false);
    }
  }, [receive]);

  const control = useCallback(
    async (command: MediaCommand, positionMs?: number) => {
      if (!nativeAvailable || operating.current) return;
      operating.current = true;
      setBusy(true);
      try {
        receive(await controlMedia(command, positionMs));
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        operating.current = false;
        setBusy(false);
      }
    },
    [receive],
  );

  return { snapshot, error, busy, refresh, control, lyrics };
}
