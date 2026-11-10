import { useEffect, useRef, useState } from "react";
import {
  configureNotchHost,
  nativeAvailable,
  onNotchHostChanged,
  type NotchHost,
  type NotchPlacement,
} from "../../../platform/tauri/shell";
import { HOST_CAPACITY } from "./layout";

export function useNotchHost(
  placement: NotchPlacement,
  topOffset: number,
  attempt: number,
  report: (message: string) => void,
) {
  const [host, setHost] = useState<NotchHost | null>(null);
  const callbacks = useRef({ report });
  callbacks.current = { report };
  const chain = useRef(Promise.resolve());
  const version = useRef(0);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    let failed = false;
    let frame = 0;
    let unlisten: (() => void) | undefined;
    let viewport = `${window.innerWidth},${window.innerHeight},${window.devicePixelRatio}`;
    const commit = (applied: NotchHost) => {
      setHost((previous) => (previous?.revision === applied.revision ? previous : applied));
    };
    const run = async (current: number) => {
      const isCurrent = () => active && current === version.current;
      if (!isCurrent()) return;
      try {
        const applied = await configureNotchHost(placement, topOffset, HOST_CAPACITY, attempt);
        if (!isCurrent()) return;
        commit(applied);
      } catch {
        if (!isCurrent()) return;
        failed = true;
        callbacks.current.report("Windows could not configure Otto. Retry to restore its window.");
      }
    };
    const configure = () => {
      const current = ++version.current;
      chain.current = chain.current.catch(() => {}).then(() => run(current));
    };
    const changed = () => {
      if (failed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(configure);
    };
    configure();
    const resized = () => {
      const next = `${window.innerWidth},${window.innerHeight},${window.devicePixelRatio}`;
      if (next === viewport) return;
      viewport = next;
      changed();
    };
    window.addEventListener("resize", resized);
    void onNotchHostChanged(changed)
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {
        if (active) callbacks.current.report("Windows display changes could not be observed.");
      });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      unlisten?.();
      window.removeEventListener("resize", resized);
    };
  }, [placement, topOffset, attempt]);

  return host;
}
