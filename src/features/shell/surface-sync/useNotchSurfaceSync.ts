import { useLayoutEffect, useRef, useState } from "react";
import type { NotchPlacement, NotchPosition, NotchSurface } from "../../../platform/tauri/shell";
import {
  isContentResize,
  isFirstMeasurement,
  retargetDuration,
  shouldAnimateNotch,
  type NotchGeometry,
} from "../model/motion";
import type { NotchShape } from "../model/placement";
import { createGeometryQueue } from "./geometry-queue";
import { HOST_CAPACITY, surfaceLayout } from "./layout";
import { useNotchHost } from "./useNotchHost";
import { useRenderedRegion } from "./useRenderedRegion";

export { createGeometryQueue } from "./geometry-queue";
export type { SurfaceSize } from "./layout";

type MotionState = {
  previous: NotchGeometry;
  attempt: number;
  duration: number;
  reducedMotion: boolean;
  durationMs: number;
  hostRevision: number;
  endsAt: number;
};

type MotionInput = {
  next: NotchGeometry;
  attempt: number;
  reducedMotion: boolean;
  durationMs: number;
  hostRevision: number;
};

function nextMotionState(motion: MotionState, input: MotionInput): MotionState | null {
  const { next, attempt, reducedMotion, durationMs, hostRevision } = input;
  const unchanged =
    motion.previous.surface === next.surface &&
    motion.previous.height === next.height &&
    motion.attempt === attempt &&
    motion.reducedMotion === reducedMotion &&
    motion.durationMs === durationMs &&
    motion.hostRevision === hostRevision;
  if (unchanged) return null;
  const sameHost = motion.attempt === attempt && motion.hostRevision === hostRevision;
  const animate = sameHost && shouldAnimateNotch(motion.previous, next, reducedMotion);
  const now = performance.now();
  const heightOnly = isContentResize(motion.previous, next);
  const firstMeasurement = sameHost && !reducedMotion && isFirstMeasurement(motion.previous, next);
  const duration = retargetDuration({
    animate,
    durationMs: reducedMotion ? 0 : durationMs,
    remainingMs: motion.endsAt - now,
    heightOnly,
    firstMeasurement,
  });
  return {
    previous: next,
    attempt,
    reducedMotion,
    durationMs,
    hostRevision,
    duration,
    endsAt:
      heightOnly || firstMeasurement ? Math.max(motion.endsAt, now + duration) : now + duration,
  };
}

export function useNotchSurfaceSync({
  surface,
  shape,
  topOffset,
  position = null,
  positionReset = 0,
  measuredHeight,
  reducedMotion,
  durationMs,
  attempt,
  onObserved,
  onError,
  onMoved = () => {},
}: {
  surface: NotchSurface;
  shape: NotchShape;
  topOffset: number;
  position?: NotchPosition | null;
  positionReset?: number;
  measuredHeight: number | undefined;
  reducedMotion: boolean;
  durationMs: number;
  attempt: number;
  onObserved: (placement: NotchPlacement) => void;
  onError: (message: string) => void;
  onMoved?: (position: NotchPosition) => void;
}) {
  const host = useNotchHost({
    placement: shape === "attached" ? "attached" : "floating",
    topOffset,
    position,
    positionReset,
    attempt,
    report: onError,
    onMoved,
  });
  const next: NotchGeometry = { surface, height: measuredHeight };
  const hostRevision = host?.revision ?? 0;
  const [motion, setMotion] = useState<MotionState>({
    previous: next,
    attempt,
    duration: 0,
    reducedMotion,
    durationMs,
    hostRevision,
    endsAt: 0,
  });
  const updated = nextMotionState(motion, {
    next,
    attempt,
    reducedMotion,
    durationMs,
    hostRevision,
  });
  if (updated) setMotion(updated);
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
    durationMs: reducedMotion ? 0 : motion.duration,
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
      sizingHost: host,
      stageRef,
      placement: recovery.region.shoulder > 0 ? ("attached" as const) : ("floating" as const),
      recovery,
    };
  return {
    size,
    nativeSize: host ?? HOST_CAPACITY,
    scale: host?.scale ?? 1,
    morphMs: motion.duration,
    sizingHost: host,
    stageRef,
    placement: host?.placement ?? "floating",
    recovery,
  };
}
