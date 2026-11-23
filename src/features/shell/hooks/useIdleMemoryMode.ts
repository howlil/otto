import { useEffect, useRef } from "react";
import { setOverlayMemoryMode } from "../../../platform/tauri/overlay";
import { nativeAvailable } from "../../../platform/tauri/runtime";

const IDLE_LOW_MEMORY_DELAY_MS = 15_000;

export function useIdleMemoryMode(active: boolean, delayMs = IDLE_LOW_MEMORY_DELAY_MS) {
  const lowRef = useRef(false);

  useEffect(() => {
    if (!nativeAvailable) return;
    if (active) {
      if (lowRef.current) {
        lowRef.current = false;
        void setOverlayMemoryMode(false).catch(() => {});
      }
      return;
    }
    const timer = window.setTimeout(() => {
      if (lowRef.current) return;
      lowRef.current = true;
      void setOverlayMemoryMode(true).catch(() => {
        lowRef.current = false;
      });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
}
