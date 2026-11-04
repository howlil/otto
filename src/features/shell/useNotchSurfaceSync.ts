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
  settleAt: number | null;
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
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  targetWidth: number | undefined;
  targetHeight: number | undefined;
  shape: NotchShape;
  morphMs: number;
  queue: GeometryQueue;
  revision: { current: number };
}) {
  useEffect(() => {
    if (!nativeAvailable || !targetWidth || !targetHeight) return;
    let frame = 0;
    let lastSent = 0;
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
  }, [stageRef, targetWidth, targetHeight, shape, morphMs, queue, revision]);
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
  setMorphMs,
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
  setMorphMs: Dispatch<SetStateAction<number>>;
  setPending: Dispatch<SetStateAction<PendingSurface | null>>;
}) {
  useEffect(() => {
    revision.current += 1;
    const currentRevision = revision.current;
    let active = true;
    if (requiresMeasuredHeight(surface) && measuredHeight === undefined) {
      setMorphMs(0);
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
    setMorphMs(morphMs);
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
          settleAt: animate ? performance.now() + morphMs : null,
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
    setMorphMs,
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
  setWindowSize,
  windowSize,
}: {
  pending: PendingSurface | null;
  queue: GeometryQueue;
  revision: { current: number };
  observed: { current: (placement: NotchPlacement) => void };
  reported: { current: (message: string) => void };
  confirmed: { current: SurfaceSize | null };
  confirmedWindow: { current: SurfaceSize | null };
  settle: { current: ReturnType<typeof setTimeout> | null };
  setSize: Dispatch<SetStateAction<SurfaceSize | null>>;
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
        setSize({ width: applied.width, height: applied.height });
        setWindowSize(nextWindow);
        if (current.settleAt === null) return;
        if (settle.current) clearTimeout(settle.current);
        const delay = Math.max(0, current.settleAt - performance.now());
        settle.current = setTimeout(() => {
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
            report: () => {},
          });
        }, delay);
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
    setWindowSize,
    windowSize,
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
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observed = useRef(onObserved);
  const reported = useRef(onError);
  const confirmed = useRef<SurfaceSize | null>(null);
  const confirmedWindow = useRef<SurfaceSize | null>(null);
  const windowSize = useRef<SurfaceSize | null>(null);
  observed.current = onObserved;
  reported.current = onError;
  const [size, setSize] = useState<SurfaceSize | null>(null);
  const [nativeSize, setNativeSize] = useState<SurfaceSize | null>(null);
  const [morphMs, setMorphMs] = useState(durationMs);
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
  });

  useEffect(() => {
    queue.current.resume();
    return () => {
      queue.current.dispose();
      if (settle.current) clearTimeout(settle.current);
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
    setMorphMs,
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
    setWindowSize: setNativeSize,
    windowSize,
  });

  return { size, nativeSize, morphMs, stageRef };
}
