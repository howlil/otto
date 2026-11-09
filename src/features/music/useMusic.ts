import { useCallback, useRef, useState } from "react";
import {
  controlMedia,
  nativeAvailable,
  refreshMedia,
  type MediaCommand,
} from "../../platform/tauri/media";
import { trackKey } from "./lyrics-model";
import { useLyrics } from "./useLyrics";
import { mediaErrorMessage, useMusicConnection } from "./useMusicConnection";

export function useMusic() {
  const { snapshot, receive, connect, isActive, error: connectionError } = useMusicConnection();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operating = useRef(false);
  const lyrics = useLyrics(snapshot);

  const refresh = useCallback(async () => {
    if (!nativeAvailable || operating.current) return;
    operating.current = true;
    setBusy(true);
    try {
      await connect();
      if (!isActive()) return;
      const next = await refreshMedia();
      if (isActive()) {
        receive(next);
        setError(null);
      }
    } catch (reason) {
      if (isActive()) setError(mediaErrorMessage(reason));
    } finally {
      operating.current = false;
      if (isActive()) setBusy(false);
    }
  }, [receive, connect, isActive]);

  const control = useCallback(
    async (command: MediaCommand, positionMs?: number) => {
      if (!nativeAvailable || operating.current) return;
      operating.current = true;
      setBusy(true);
      try {
        const next = await controlMedia(command, trackKey(snapshot), positionMs);
        if (isActive()) {
          receive(next);
          setError(null);
        }
      } catch (reason) {
        if (isActive()) setError(mediaErrorMessage(reason));
      } finally {
        operating.current = false;
        if (isActive()) setBusy(false);
      }
    },
    [receive, snapshot, isActive],
  );

  return { snapshot, error: connectionError ?? error, busy, refresh, control, lyrics };
}
