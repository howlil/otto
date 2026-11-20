import { useEffect, useRef, useState } from "react";
import { onOttoOsChanged, onOttoOsDock, ottoOsActive } from "../../../platform/tauri/shell";

export function useOttoOs(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    ottoOsActive()
      .then((value) => {
        if (mounted) setActive(value);
      })
      .catch(() => {});
    onOttoOsChanged((value) => {
      if (mounted) setActive(value);
    })
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
  return active;
}

export function useOttoOsDock(enabled: boolean, onDock: () => void) {
  const handler = useRef(onDock);
  handler.current = onDock;
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    onOttoOsDock(() => handler.current())
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [enabled]);
}
