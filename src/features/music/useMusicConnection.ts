import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMediaSnapshot,
  nativeAvailable,
  subscribeMedia,
  type MediaSnapshot,
  type MediaSubscription,
} from "../../platform/tauri/media";

export function mediaErrorMessage(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "System media could not be reached.";
}

function initialSnapshot(): MediaSnapshot {
  return {
    seq: 0,
    status: nativeAvailable ? "loading" : "unsupported",
    playback: "unknown",
    title: null,
    artist: null,
    artworkDataUrl: null,
    positionMs: null,
    durationMs: null,
    minSeekMs: null,
    maxSeekMs: null,
    controls: { toggle: false, previous: false, next: false, seek: false },
    message: nativeAvailable
      ? "Checking system media."
      : "System media is available in Otto on Windows.",
  };
}

function useMusicSubscription(receive: (snapshot: MediaSnapshot) => void) {
  const [error, setError] = useState<string | null>(null);
  const subscription = useRef<MediaSubscription | null>(null);
  const connecting = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const isActive = useCallback(() => mounted.current, []);
  const connect = useCallback(() => {
    if (subscription.current) return Promise.resolve();
    if (connecting.current) return connecting.current;
    const revision = ++generation.current;
    const current = () => mounted.current && revision === generation.current;
    const pending = Promise.resolve()
      .then(() => subscribeMedia((next) => current() && receive(next)))
      .then(async (next) => {
        if (!current()) {
          await next.unsubscribe();
          return;
        }
        subscription.current = next;
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!current()) return;
        generation.current += 1;
        connecting.current = null;
        setError(mediaErrorMessage(reason));
      })
      .finally(() => {
        if (connecting.current === pending) connecting.current = null;
      });
    connecting.current = pending;
    return pending;
  }, [receive]);

  useEffect(() => {
    if (!nativeAvailable) return;
    mounted.current = true;
    void connect();
    return () => {
      mounted.current = false;
      generation.current += 1;
      connecting.current = null;
      void subscription.current?.unsubscribe().catch(() => {});
      subscription.current = null;
    };
  }, [connect]);
  return { connect, error, isActive };
}

export function useMusicConnection() {
  const [snapshot, setSnapshot] = useState<MediaSnapshot>(initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const latestSequence = useRef(-1);
  const receive = useCallback((next: MediaSnapshot) => {
    if (next.seq < latestSequence.current) return;
    latestSequence.current = next.seq;
    setSnapshot(next);
    setError(null);
  }, []);
  const subscription = useMusicSubscription(receive);
  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    void getMediaSnapshot()
      .then((next) => active && receive(next))
      .catch((reason: unknown) => active && setError(mediaErrorMessage(reason)));
    return () => {
      active = false;
    };
  }, [receive]);
  return { ...subscription, snapshot, receive, error: subscription.error ?? error };
}
