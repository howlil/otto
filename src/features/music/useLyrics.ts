import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMediaLyrics,
  setOnlineLyrics,
  type LyricsRecord,
  type MediaSnapshot,
} from "../../platform/tauri/media";
import { trackKey } from "./lyrics-model";

type LyricsState = {
  key: string;
  status: "off" | "loading" | "ready" | "missing" | "error";
  record: LyricsRecord | null;
  error: string | null;
};
const empty: LyricsState = { key: "", status: "off", record: null, error: null };

export function useLyrics(snapshot: MediaSnapshot) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LyricsState>(empty);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const permissionRevision = useRef(0);
  const key = trackKey(snapshot);
  const available = snapshot.status === "available";

  useEffect(() => {
    const revision = ++generation.current;
    if (!enabled || !available) return;
    setState({ key, status: "loading", record: null, error: null });
    void getMediaLyrics(attempt > 0)
      .then((result) => {
        if (revision !== generation.current || result.key !== key) return;
        setState({
          key,
          status: result.record ? "ready" : "missing",
          record: result.record,
          error: null,
        });
      })
      .catch((reason: unknown) => {
        if (revision !== generation.current) return;
        setState({
          key,
          status: "error",
          record: null,
          error:
            typeof reason === "string"
              ? reason
              : reason instanceof Error
                ? reason.message
                : "Lyrics could not be loaded.",
        });
      });
    return () => {
      generation.current += 1;
    };
  }, [enabled, available, key, attempt]);

  useEffect(
    () => () => {
      generation.current += 1;
      permissionRevision.current += 1;
      void setOnlineLyrics(false).catch(() => {});
    },
    [],
  );

  const enable = useCallback(async () => {
    const revision = ++permissionRevision.current;
    try {
      await setOnlineLyrics(true);
      if (revision === permissionRevision.current) setEnabled(true);
    } catch {
      if (revision === permissionRevision.current)
        setState({
          key,
          status: "error",
          record: null,
          error: "Online lyrics could not be enabled. Try again.",
        });
    }
  }, [key]);

  const disable = useCallback(async () => {
    permissionRevision.current += 1;
    generation.current += 1;
    setEnabled(false);
    setState(empty);
    try {
      await setOnlineLyrics(false);
    } catch {
      setState({
        ...empty,
        key,
        error: "Lyrics permission could not be updated. Retry disabling it.",
      });
    }
  }, [key]);

  const current =
    enabled && available && state.key === key
      ? state
      : { ...empty, error: state.key === key ? state.error : null };
  return {
    ...current,
    enabled,
    open,
    setOpen,
    enable,
    disable,
    retry: () => setAttempt((value) => value + 1),
  };
}

export type LyricsController = ReturnType<typeof useLyrics>;
