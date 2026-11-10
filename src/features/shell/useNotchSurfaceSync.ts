import { useLayoutEffect, useRef, useState } from "react";
import type { NotchPlacement, NotchSurface } from "../../platform/tauri/shell";
import {
  cappedMorphDuration,
  isContentResize,
  shouldAnimateNotch,
  type NotchGeometry,
} from "./motion";
import type { NotchShape } from "./placement";
import { createGeometryQueue } from "./surface-sync";
import { HOST_CAPACITY, surfaceLayout, compactRadiusFor } from "./surface-sync/layout";
import { useNotchHost } from "./surface-sync/useNotchHost";
import { useRenderedRegion } from "./surface-sync/useRenderedRegion";

export { createGeometryQueue } from "./surface-sync";
export type { SurfaceSize } from "./surface-sync/layout";

export function useNotchSurfaceSync({
  surface,
  shape,
  topOffset,
  measuredHeight,
  reducedMotion,
  durationMs,
  attempt,
  onObserved,
  onError,
}: {
  surface: NotchSurface;
  shape: NotchShape;
  topOffset: number;
  measuredHeight: number | undefined;
  reducedMotion: boolean;
  durationMs: number;
  attempt: number;
  onObserved: (placement: NotchPlacement) => void;
  onError: (message: string) => void;
}) {
  const host = useNotchHost(
    shape === "attached" ? "attached" : "floating",
    topOffset,
    attempt,
    onError,
  );
  const next: NotchGeometry = { surface, height: measuredHeight };
  const hostRevision = host?.revision ?? 0;
  const [motion, setMotion] = useState({
    previous: next,
    attempt,
    duration: 0,
    reducedMotion,
    durationMs,
    hostRevision,
  });
  if (
    motion.previous.surface !== surface ||
    motion.previous.height !== measuredHeight ||
    motion.attempt !== attempt ||
    motion.reducedMotion !== reducedMotion ||
    motion.durationMs !== durationMs ||
    motion.hostRevision !== hostRevision
  ) {
    const animate =
      motion.attempt === attempt &&
      motion.hostRevision === hostRevision &&
      shouldAnimateNotch(motion.previous, next, reducedMotion);
    setMotion({
      previous: next,
      attempt,
      reducedMotion,
      durationMs,
      hostRevision,
      duration: animate
        ? cappedMorphDuration(durationMs, isContentResize(motion.previous, next))
        : 0,
    });
  }
  const size = surfaceLayout(surface, shape, measuredHeight, host);
  const stageRef = useRef<HTMLDivElement>(null);
  const queue = useRef(createGeometryQueue());
  useLayoutEffect(() => {
    queue.current.resume();
    return () => queue.current.dispose();
  }, []);
  const recovery = useRenderedRegion({
    stageRef,
    host,
    size,
    shape,
    durationMs: reducedMotion ? 0 : durationMs,
    retry: attempt,
    queue: queue.current,
    onError,
    onObserved: (placement) => {
      if (placement === (shape === "attached" ? "attached" : "floating")) onObserved(placement);
    },
  });
  if (recovery)
    return {
      size: {
        width: recovery.region.body.width / recovery.scale,
        height: recovery.region.body.height / recovery.scale,
      },
      nativeSize: host ?? HOST_CAPACITY,
      scale: recovery.scale,
      morphMs: 0,
      compactRadius: compactRadiusFor(surface, host),
      stageRef,
      placement: recovery.region.shoulder > 0 ? ("attached" as const) : ("floating" as const),
      recovery,
    };
  return {
    size,
    nativeSize: host ?? HOST_CAPACITY,
    scale: host?.scale ?? 1,
    morphMs: motion.duration,
    compactRadius: compactRadiusFor(surface, host),
    stageRef,
    placement: host?.placement ?? "floating",
    recovery,
  };
}
