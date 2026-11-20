import { useEffect, useRef, useState } from "react";
import {
  configureNotchHost,
  onNotchHostChanged,
  type NotchHost,
  type NotchPlacement,
  type NotchPosition,
} from "../../../platform/tauri/shell";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { HOST_CAPACITY } from "./layout";

export function useNotchHost({
  placement,
  topOffset,
  position,
  positionReset,
  attempt,
  report,
  onMoved,
}: {
  placement: NotchPlacement;
  topOffset: number;
  position: NotchPosition | null;
  positionReset: number;
  attempt: number;
  report: (message: string) => void;
  onMoved: (position: NotchPosition) => void;
}) {
  const [host, setHost] = useState<NotchHost | null>(null);
  const callbacks = useRef({ report, onMoved });
  callbacks.current = { report, onMoved };
  const positionRef = useRef(position);
  positionRef.current = position;
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
    const configuredPosition = () => (placement === "floating" ? positionRef.current : null);
    const run = async (current: number, resetRevision: number) => {
      const isCurrent = () =>
        active && current === version.current && resetRevision === positionReset;
      if (!isCurrent()) return;
      try {
        const applied = await configureNotchHost(
          placement,
          topOffset,
          HOST_CAPACITY,
          configuredPosition(),
          attempt,
        );
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
      chain.current = chain.current.catch(() => {}).then(() => run(current, positionReset));
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
    void onNotchHostChanged(changed, (moved) => {
      callbacks.current.onMoved(moved);
    })
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
  }, [placement, topOffset, positionReset, attempt]);

  return host;
}
