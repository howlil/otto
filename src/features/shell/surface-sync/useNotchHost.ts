import { useEffect, useRef, useState } from "react";
import {
  configureNotchHost,
  onNotchHostChanged,
  type NotchHost,
  type NotchPlacement,
  type NotchPosition,
  type NotchRectPx,
} from "../../../platform/tauri/shell";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { HOST_CAPACITY } from "./layout";

export type HostSettleRequest = {
  id: number;
  position: NotchPosition;
  surfaceRect: NotchRectPx | null;
};

export function useNotchHost({
  placement,
  topOffset,
  position,
  positionReset,
  dockWithOttoOs = true,
  compactCircle = false,
  settle = null,
  attempt,
  report,
  onMoved,
  onSettled,
}: {
  placement: NotchPlacement;
  topOffset: number;
  position: NotchPosition | null;
  positionReset: number;
  dockWithOttoOs?: boolean;
  compactCircle?: boolean;
  settle?: HostSettleRequest | null;
  attempt: number;
  report: (message: string) => void;
  onMoved: (position: NotchPosition) => void;
  onSettled?: (position: NotchPosition) => void;
}) {
  const [host, setHost] = useState<NotchHost | null>(null);
  const callbacks = useRef({ report, onMoved, onSettled });
  callbacks.current = { report, onMoved, onSettled };
  const positionRef = useRef(position);
  positionRef.current = position;
  const compactCircleRef = useRef(compactCircle);
  compactCircleRef.current = compactCircle;
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const appliedSettleId = useRef(0);
  const chain = useRef(Promise.resolve());
  const version = useRef(0);
  const settleId = settle?.id ?? 0;

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    let failed = false;
    let frame = 0;
    let unlisten: (() => void) | undefined;
    let viewport = `${window.innerWidth},${window.innerHeight},${window.devicePixelRatio}`;
    const commit = (applied: NotchHost, hadCustomPosition: boolean) => {
      setHost((previous) => (previous?.revision === applied.revision ? previous : applied));
      if (hadCustomPosition && applied.position) {
        callbacks.current.onSettled?.(applied.position);
      }
    };
    const configuredRequest = () => {
      if (placement !== "floating") return { pos: null, surfaceRect: null };
      const pending = settleId > 0 ? settleRef.current : null;
      if (pending && pending.id === settleId && pending.id !== appliedSettleId.current) {
        appliedSettleId.current = pending.id;
        return { pos: pending.position, surfaceRect: pending.surfaceRect };
      }
      return { pos: positionRef.current, surfaceRect: null };
    };
    const run = async (current: number, resetRevision: number) => {
      const isCurrent = () =>
        active && current === version.current && resetRevision === positionReset;
      if (!isCurrent()) return;
      const { pos, surfaceRect } = configuredRequest();
      try {
        const applied = await configureNotchHost(placement, topOffset, HOST_CAPACITY, pos, {
          attempt,
          dockWithOttoOs,
          compactCircle: compactCircleRef.current,
          surfaceRect,
        });
        if (!isCurrent()) return;
        commit(applied, pos !== null);
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
  }, [placement, topOffset, dockWithOttoOs, positionReset, settleId, attempt]);

  return host;
}
