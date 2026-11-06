import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  measureNotchSurface,
  nativeAvailable,
  type setNotchSurface,
} from "../../platform/tauri/shell";
import type { NotchPlacement, NotchSurfaceRequest, NotchSurface } from "../../platform/tauri/shell";
import {
  cappedMorphDuration,
  isContentResize,
  shouldAnimateNotch,
  type NotchGeometry,
} from "./motion";
import type { NotchShape } from "./placement";
import { createGeometryQueue } from "./surface-sync";

export { createGeometryQueue } from "./surface-sync";

export type SurfaceSize = { width: number; height: number };

type GeometryQueue = ReturnType<typeof createGeometryQueue>;
type PendingSurface = {
  revision: number;
  request: NotchSurfaceRequest;
  settleMs: number | null;
  morphMs: number;
};

function requiresMeasuredHeight(surface: NotchSurface): boolean {
  return (
    surface === "homeSettings" ||
    surface === "agentReady" ||
    surface === "agentThinking" ||
    surface === "agentFull" ||
    surface === "agentError" ||
    surface === "agentSettings"
  );
}

function useNotchHitRegionSync({
  stageRef,
  targetWidth,
  targetHeight,
  shape,
  morphMs,
  queue,
  revision,
  reported,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  targetWidth: number | undefined;
  targetHeight: number | undefined;
  shape: NotchShape;
  morphMs: number;
  queue: GeometryQueue;
  revision: { current: number };
  reported: { current: (message: string) => void };
}) {
  useEffect(() => {
    if (!nativeAvailable || !targetWidth || !targetHeight) return;
    let frame = 0;
    let lastSent = 0;
    let errorReported = false;
    const started = performance.now();
    const currentRevision = revision.current;
    const surface = () => {
      const rect = stageRef.current?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0
        ? { width: rect.width, height: rect.height }
        : { width: targetWidth, height: targetHeight };
    };
    const send = () => {
      const measured = surface();
      queue.enqueueHit(
        measured.width,
        measured.height,
        shape,
        () => currentRevision === revision.current,
        () => {
          if (errorReported) return;
          errorReported = true;
          reported.current("Windows could not update Otto's hit region.");
        },
      );
    };
    const tick = (now: number) => {
      if (now - lastSent >= 33) {
        lastSent = now;
        send();
      }
      if (now - started < morphMs) frame = requestAnimationFrame(tick);
      else send();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stageRef, targetWidth, targetHeight, shape, morphMs, queue, revision, reported]);
}

function useSurfaceMeasurement({
  surface,
  shape,
  topOffset,
  measuredHeight,
  reducedMotion,
  durationMs,
  attempt,
  previous,
  lastAttempt,
  revision,
  reported,
  settle,
  setPending,
}: {
  surface: NotchSurface;
  shape: NotchShape;
  topOffset: number;
  measuredHeight: number | undefined;
  reducedMotion: boolean;
  durationMs: number;
  attempt: number;
  previous: { current: NotchGeometry | null };
  lastAttempt: { current: number };
  revision: { current: number };
  reported: { current: (message: string) => void };
  settle: { current: (() => void) | null };
  setPending: Dispatch<SetStateAction<PendingSurface | null>>;
}) {
  useEffect(() => {
    revision.current += 1;
    const currentRevision = revision.current;
    if (settle.current) settle.current();
    settle.current = null;
    let active = true;
    if (requiresMeasuredHeight(surface) && measuredHeight === undefined) {
      return () => {
        active = false;
      };
    }
    if (lastAttempt.current !== attempt) {
      lastAttempt.current = attempt;
      previous.current = null;
    }
    const next: NotchGeometry = { surface, height: measuredHeight };
    const animate = shouldAnimateNotch(previous.current, next, reducedMotion);
    const morphMs = animate
      ? cappedMorphDuration(durationMs, isContentResize(previous.current, next))
      : 0;
    previous.current = next;
    const request = { surface, shape, topOffset, contentHeight: measuredHeight } satisfies Omit<
      NotchSurfaceRequest,
      "deferShrink"
    >;
    void measureNotchSurface(request)
      .then(() => {
        if (!active || currentRevision !== revision.current) return;
        setPending({
          revision: currentRevision,
          request: { ...request, deferShrink: animate },
          settleMs: animate ? morphMs : null,
          morphMs,
        });
      })
      .catch(() => {
        if (active && currentRevision === revision.current) {
          reported.current("Notch resizing is unavailable in this Windows session.");
        }
      });
    return () => {
      active = false;
    };
  }, [
    surface,
    shape,
    topOffset,
    measuredHeight,
    reducedMotion,
    durationMs,
    attempt,
    previous,
    lastAttempt,
    revision,
    reported,
    settle,
    setPending,
  ]);
}

function acceptSurfaceAck(
  applied: Awaited<ReturnType<typeof setNotchSurface>>,
  currentRevision: number,
  revision: { current: number },
  reported: { current: (message: string) => void },
): boolean {
  if (applied.geometryConfirmed) return true;
  if (currentRevision === revision.current) {
    reported.current("Notch resizing is unavailable in this Windows session.");
  }
  return false;
}

function settleAfterStageTransition(
  stage: HTMLElement | null,
  durationMs: number,
  onSettled: () => void,
): () => void {
  let active = true;
  const onTransitionEnd = (event: Event) => {
    if (event.target !== stage) return;
    const property = (event as TransitionEvent).propertyName;
    if (property === "width" || property === "height") finish();
  };
  const stop = () => {
    active = false;
    clearTimeout(timeout);
    stage?.removeEventListener("transitionend", onTransitionEnd);
  };
  const finish = () => {
    if (!active) return;
    stop();
    onSettled();
  };
  const timeout = setTimeout(finish, durationMs + 80);
  stage?.addEventListener("transitionend", onTransitionEnd);
  return stop;
}

function useSurfaceApply({
  pending,
  queue,
  revision,
  observed,
  reported,
  confirmed,
  confirmedWindow,
  settle,
  setSize,
  setMorphMs,
  setWindowSize,
  windowSize,
  stageRef,
}: {
  pending: PendingSurface | null;
  queue: GeometryQueue;
  revision: { current: number };
  observed: { current: (placement: NotchPlacement) => void };
  reported: { current: (message: string) => void };
  confirmed: { current: SurfaceSize | null };
  confirmedWindow: { current: SurfaceSize | null };
  settle: { current: (() => void) | null };
  setSize: Dispatch<SetStateAction<SurfaceSize | null>>;
  setMorphMs: Dispatch<SetStateAction<number>>;
  stageRef: RefObject<HTMLDivElement | null>;
  setWindowSize: Dispatch<SetStateAction<SurfaceSize | null>>;
  windowSize: { current: SurfaceSize | null };
}) {
  useEffect(() => {
    if (!pending) return;
    const current = pending;
    queue.enqueueSurface({
      request: current.request,
      isCurrent: () => current.revision === revision.current,
      apply: (applied) => {
        if (!acceptSurfaceAck(applied, current.revision, revision, reported)) return;
        confirmed.current = { width: applied.width, height: applied.height };
        const nextWindow = current.request.deferShrink
          ? {
              width: Math.max(windowSize.current?.width ?? 0, applied.width),
              height: Math.max(windowSize.current?.height ?? 0, applied.height),
            }
          : { width: applied.width, height: applied.height };
        windowSize.current = nextWindow;
        confirmedWindow.current = nextWindow;
        observed.current(applied.placement);
        setMorphMs(current.morphMs);
        setSize({ width: applied.width, height: applied.height });
        setWindowSize(nextWindow);
        if (current.settleMs === null) return;
        if (settle.current) settle.current();
        settle.current = settleAfterStageTransition(stageRef.current, current.settleMs, () => {
          settle.current = null;
          if (current.revision !== revision.current) return;
          queue.enqueueSurface({
            request: { ...current.request, deferShrink: false },
            isCurrent: () => current.revision === revision.current,
            apply: (applied) => {
              confirmedWindow.current = { width: applied.width, height: applied.height };
              windowSize.current = confirmedWindow.current;
              setWindowSize(confirmedWindow.current);
            },
            report: () => {
              if (current.revision === revision.current) {
                reported.current("The notch could not finish resizing in this Windows session.");
              }
            },
          });
        });
      },
      report: () => {
        if (current.revision !== revision.current) return;
        setSize(confirmed.current);
        setWindowSize(confirmedWindow.current);
        reported.current("Notch resizing is unavailable in this Windows session.");
      },
    });
  }, [
    pending,
    queue,
    revision,
    observed,
    reported,
    confirmed,
    confirmedWindow,
    settle,
    setSize,
    setMorphMs,
    setWindowSize,
    windowSize,
    stageRef,
  ]);
}

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
  const previous = useRef<NotchGeometry | null>(null);
  const lastAttempt = useRef(attempt);
  const settle = useRef<(() => void) | null>(null);
  const observed = useRef(onObserved);
  const reported = useRef(onError);
  const confirmed = useRef<SurfaceSize | null>(null);
  const confirmedWindow = useRef<SurfaceSize | null>(null);
  const windowSize = useRef<SurfaceSize | null>(null);
  observed.current = onObserved;
  reported.current = onError;
  const [size, setSize] = useState<SurfaceSize | null>(null);
  const [nativeSize, setNativeSize] = useState<SurfaceSize | null>(null);
  const [morphMs, setMorphMs] = useState(0);
  const [pending, setPending] = useState<PendingSurface | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const queue = useRef(createGeometryQueue());
  const targetWidth = size?.width;
  const targetHeight = size?.height;
  useNotchHitRegionSync({
    stageRef,
    targetWidth,
    targetHeight,
    shape,
    morphMs,
    queue: queue.current,
    revision,
    reported,
  });

  useEffect(() => {
    queue.current.resume();
    return () => {
      queue.current.dispose();
      if (settle.current) settle.current();
    };
  }, []);

  useSurfaceMeasurement({
    surface,
    shape,
    topOffset,
    measuredHeight,
    reducedMotion,
    durationMs,
    attempt,
    previous,
    lastAttempt,
    revision,
    reported,
    settle,
    setPending,
  });
  useSurfaceApply({
    pending,
    queue: queue.current,
    revision,
    observed,
    reported,
    confirmed,
    confirmedWindow,
    settle,
    setSize,
    setMorphMs,
    setWindowSize: setNativeSize,
    windowSize,
    stageRef,
  });

  return { size, nativeSize, morphMs, stageRef };
}
