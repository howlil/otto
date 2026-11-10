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
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LyricsState>(empty);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const permission = useRef(Promise.resolve());
  const key = trackKey(snapshot);
  const available = snapshot.status === "available";
  const setPermission = useCallback((enabled: boolean) => {
    permission.current = permission.current.catch(() => {}).then(() => setOnlineLyrics(enabled));
    return permission.current;
  }, []);

  const observe = useCallback(() => {
    const revision = ++generation.current;
    if (!available) return () => {};
    const current = () => revision === generation.current;
    setState({ key, status: "loading", record: null, error: null });
    void setPermission(true)
      .then(async () => {
        if (!current()) return;
        const result = await getMediaLyrics(attempt > 0);
        if (!current()) return;
        if (result.key !== key) throw new Error("The media item changed. Retry lyrics.");
        setState({
          key,
          status: result.record ? "ready" : "missing",
          record: result.record,
          error: null,
        });
      })
      .catch((reason: unknown) => {
        if (!current()) return;
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
      if (!current()) return;
      generation.current += 1;
      void setPermission(false).catch(() => {});
    };
  }, [available, key, attempt, setPermission]);

  useEffect(
    () => () => {
      generation.current += 1;
      void setPermission(false).catch(() => {});
    },
    [setPermission],
  );

  return {
    ...(available && state.key === key ? state : empty),
    open,
    setOpen,
    observe,
    retry: () => setAttempt((value) => value + 1),
  };
}

export type LyricsController = ReturnType<typeof useLyrics>;
