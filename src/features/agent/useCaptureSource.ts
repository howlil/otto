import { useCallback, useEffect, useRef, useState } from "react";
import {
  configureCaptureSource,
  nativeAvailable,
  type CaptureSource,
} from "../../platform/tauri";

function savedCaptureSource(): CaptureSource {
  try {
    return localStorage.getItem("otto.capture.source") === "fullScreen" ? "fullScreen" : "window";
  } catch {
    return "window";
  }
}

export function useCaptureSource(onMessage: (message: string) => void) {
  const [source, setSource] = useState<CaptureSource>(savedCaptureSource);
  const [sourceReady, setSourceReady] = useState(false);
  const [sourcePending, setSourcePending] = useState(nativeAvailable);
  const locked = useRef(nativeAvailable);
  const initial = useRef(source);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    void configureCaptureSource(initial.current)
      .then(() => {
        if (active) setSourceReady(true);
      })
      .catch((cause: unknown) => {
        if (active) {
          setSourceReady(false);
          onMessage("Capture source not confirmed: " + String(cause));
        }
      })
      .finally(() => {
        if (active) {
          locked.current = false;
          setSourcePending(false);
        }
      });
    return () => {
      active = false;
    };
  }, [onMessage]);

  const selectSource = useCallback(
    async (next: CaptureSource) => {
      if (!nativeAvailable || locked.current) return;
      locked.current = true;
      setSourcePending(true);
      try {
        await configureCaptureSource(next);
        setSource(next);
        setSourceReady(true);
        try {
          localStorage.setItem("otto.capture.source", next);
          onMessage("Capture source confirmed. Press the shortcut to capture.");
        } catch {
          onMessage("Source confirmed; preference could not be saved.");
        }
      } catch (cause) {
        setSourceReady(false);
        onMessage("Capture source not confirmed: " + String(cause));
      } finally {
        locked.current = false;
        setSourcePending(false);
      }
    },
    [onMessage],
  );

  return { source, selectSource, sourceReady, sourcePending };
}
