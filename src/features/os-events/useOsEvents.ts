import { useCallback, useEffect, useRef, useState } from "react";
import {
  nativeAvailable,
  subscribeOsEvents,
  type OsEventSubscription,
  type OsEventView,
} from "../../platform/tauri";

const DISPLAY_MS = 2_400;

export function useOsEvents() {
  const [event, setEvent] = useState<OsEventView | null>(null);
  const subscription = useRef<OsEventSubscription | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
    setEvent(null);
  }, []);

  const show = useCallback((next: OsEventView) => {
    setEvent(next);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      setEvent(null);
    }, DISPLAY_MS);
  }, []);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    void subscribeOsEvents(show)
      .then((next) => {
        if (active) subscription.current = next;
        else void next.unsubscribe();
      })
      .catch(() => {});
    return () => {
      active = false;
      void subscription.current?.unsubscribe();
      subscription.current = null;
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    };
  }, [show]);

  return { event, dismiss };
}
