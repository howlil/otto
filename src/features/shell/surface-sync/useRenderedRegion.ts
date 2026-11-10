import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { NotchHost, NotchRegionPx, NotchPlacement } from "../../../platform/tauri";
import { SHOULDER_PX, type NotchShape } from "../placement";
import type { createGeometryQueue } from "./geometry-queue";
import type { SurfaceSize } from "./layout";

export type RecoveryFrame = { region: NotchRegionPx; scale: number };

export function renderedRegion(
  stage: HTMLElement,
  host: NotchHost,
  sequence: number,
): NotchRegionPx | null {
  const rect = stage.getBoundingClientRect();
  const main = stage.querySelector("main");
  if (!main || rect.width <= 0 || rect.height <= 0) return null;
  const css = getComputedStyle(main);
  const scale = host.scale;
  const attached = stage.closest("[data-placement]")?.getAttribute("data-placement") === "attached";
  const shoulder = attached
    ? Math.round(
        (Number.parseFloat(getComputedStyle(stage).getPropertyValue("--otto-shoulder")) ||
          SHOULDER_PX) * scale,
      )
    : 0;
  const x = Math.max(shoulder, Math.floor(rect.left * scale));
  const y = Math.max(0, Math.floor(rect.top * scale));
  const right = Math.min(Math.round(host.width * scale) - shoulder, Math.ceil(rect.right * scale));
  const bottom = Math.min(Math.round(host.height * scale), Math.ceil(rect.bottom * scale));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  const limit = Math.floor(Math.min(width, height) / 2);
  const radius = (value: string) =>
    Math.max(0, Math.min(limit, Math.floor((Number.parseFloat(value) || 0) * scale)));
  return {
    hostRevision: host.revision,
    sequence,
    body: { x, y, width, height },
    radius: { top: radius(css.borderTopLeftRadius), bottom: radius(css.borderBottomLeftRadius) },
    shoulder,
  };
}

export function useRenderedRegion({
  stageRef,
  host,
  size,
  shape,
  durationMs,
  retry,
  queue,
  onError,
  onObserved,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  host: NotchHost | null;
  size: SurfaceSize;
  shape: NotchShape;
  durationMs: number;
  retry: number;
  queue: ReturnType<typeof createGeometryQueue>;
  onError: (message: string) => void;
  onObserved: (placement: NotchPlacement) => void;
}) {
  const sequence = useRef(0);
  const confirmed = useRef<NotchRegionPx | null>(null);
  const observedRevision = useRef(0);
  const observed = useRef(onObserved);
  observed.current = onObserved;
  const [failure, setFailure] = useState<{ retry: number; region: NotchRegionPx } | null>(null);
  const report = useRef(onError);
  report.current = onError;
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !host) return;
    queue.configure(host.revision);
    queue.resume();
    let frame = 0;
    let failed = false;
    let active = true;
    const deadline = performance.now() + durationMs + (durationMs > 0 ? 80 : 0);
    const send = () => {
      if (failed) return;
      const region = renderedRegion(stage, host, ++sequence.current);
      if (!region) return;
      queue.enqueue(
        region,
        () => {
          if (!active || failed) return;
          failed = true;
          queue.dispose();
          setFailure({ retry, region: confirmed.current ?? region });
          report.current("Windows could not update Otto's shape. Retry to restore it.");
        },
        () => {
          confirmed.current = region;
          if (observedRevision.current !== host.revision) {
            observedRevision.current = host.revision;
            observed.current(host.placement);
          }
        },
      );
    };
    const tick = (now: number) => {
      send();
      const rect = stage.getBoundingClientRect();
      const reached =
        Math.abs(rect.width - size.width) < 0.5 && Math.abs(rect.height - size.height) < 0.5;
      const attached =
        stage.closest("[data-placement]")?.getAttribute("data-placement") === "attached";
      const settled = reached && attached === (shape === "attached");
      const keepSampling = now < deadline || (!settled && now < deadline + 80);
      if (!failed && keepSampling) frame = requestAnimationFrame(tick);
    };
    send();
    frame = requestAnimationFrame(tick);
    stage.addEventListener("transitionend", send);
    stage.addEventListener("transitioncancel", send);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stage.removeEventListener("transitionend", send);
      stage.removeEventListener("transitioncancel", send);
    };
  }, [stageRef, host, size.width, size.height, shape, durationMs, retry, queue]);
  return failure?.retry === retry ? { region: failure.region, scale: host?.scale ?? 1 } : null;
}
