import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { NotchHost, NotchRegionPx, NotchPlacement } from "../../../platform/tauri";
import { SHOULDER_PX, type NotchShape } from "../model/placement";
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

export function targetRegion(
  host: NotchHost,
  size: SurfaceSize,
  shape: NotchShape,
  sequence: number,
): NotchRegionPx | null {
  const scale = host.scale;
  const shoulder = shape === "attached" ? Math.round(SHOULDER_PX * scale) : 0;
  const hostWidth = Math.round(host.width * scale);
  const hostHeight = Math.round(host.height * scale);
  const horizontal = host.anchor?.horizontal ?? "center";
  const vertical = host.anchor?.vertical ?? "top";
  const left =
    horizontal === "left"
      ? 0
      : horizontal === "right"
        ? (host.width - size.width) * scale
        : ((host.width - size.width) / 2) * scale;
  const x = Math.max(shoulder, Math.floor(left) - 1);
  const right = Math.min(hostWidth - shoulder, Math.ceil(left + size.width * scale) + 1);
  const y =
    vertical === "bottom" ? Math.max(0, Math.floor((host.height - size.height) * scale) - 1) : 0;
  const bottom =
    vertical === "bottom" ? hostHeight : Math.min(hostHeight, Math.ceil(size.height * scale) + 1);
  if (right <= x || bottom <= y) return null;
  return {
    hostRevision: host.revision,
    sequence,
    body: { x, y, width: right - x, height: bottom - y },
    radius: { top: 0, bottom: 0 },
    shoulder,
    morph: true,
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
  const { width: sizeWidth, height: sizeHeight } = size;
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
    const push = (region: NotchRegionPx) => {
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
          if (!region.morph) confirmed.current = region;
          if (observedRevision.current !== host.revision) {
            observedRevision.current = host.revision;
            observed.current(host.placement);
          }
        },
      );
    };
    const send = () => {
      if (failed) return;
      const region = renderedRegion(stage, host, ++sequence.current);
      if (region) push(region);
    };
    const morphing = durationMs > 0 && confirmed.current !== null;
    const lead = morphing
      ? targetRegion(host, { width: sizeWidth, height: sizeHeight }, shape, sequence.current + 1)
      : null;
    if (lead) {
      sequence.current += 1;
      push(lead);
    } else {
      send();
    }
    let last = performance.now();
    let worst = 0;
    const tick = (now: number) => {
      worst = Math.max(worst, now - last);
      last = now;
      const rect = stage.getBoundingClientRect();
      const reached =
        Math.abs(rect.width - sizeWidth) < 0.5 && Math.abs(rect.height - sizeHeight) < 0.5;
      const attached =
        stage.closest("[data-placement]")?.getAttribute("data-placement") === "attached";
      const settled = reached && attached === (shape === "attached");
      const keepSampling = now < deadline || (!settled && now < deadline + 80);
      if (!failed && keepSampling) {
        frame = requestAnimationFrame(tick);
        return;
      }
      send();
      if (lead && import.meta.env.DEV) {
        console.debug("otto morph", { durationMs, worstFrameMs: Math.round(worst) });
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [stageRef, host, sizeWidth, sizeHeight, shape, durationMs, retry, queue]);
  return failure?.retry === retry ? { region: failure.region, scale: host?.scale ?? 1 } : null;
}
