import { setNotchHitRegion, setNotchSurface } from "../../../platform/tauri";
import type { NotchSurfaceRequest } from "../../../platform/tauri";
import type { NotchShape } from "../placement";

type SurfaceQueueItem = {
  request: NotchSurfaceRequest;
  isCurrent: () => boolean;
  apply: (value: Awaited<ReturnType<typeof setNotchSurface>>) => void;
  report: () => void;
};

type HitQueueItem = {
  width: number;
  height: number;
  shape: NotchShape;
  generation: number;
  isCurrent: () => boolean;
};

type QueueOperation =
  | { kind: "surface"; item: SurfaceQueueItem }
  | { kind: "hit"; item: HitQueueItem };

export function createGeometryQueue() {
  let pendingSurface: SurfaceQueueItem | null = null;
  let pendingHit: HitQueueItem | null = null;
  let generation = 0;
  let running = false;
  let disposed = false;

  const flushSurface = async (surface: SurfaceQueueItem) => {
    try {
      const applied = await setNotchSurface(surface.request);
      if (!disposed && surface.isCurrent()) surface.apply(applied);
    } catch {
      if (!disposed && surface.isCurrent()) surface.report();
    }
  };

  const flushHit = async (hit: HitQueueItem) => {
    if (!isCurrent({ kind: "hit", item: hit })) return;
    await setNotchHitRegion(hit.width, hit.height, hit.shape);
  };

  const takeOperation = (): QueueOperation | null => {
    const surface = pendingSurface;
    if (surface) {
      pendingSurface = null;
      return { kind: "surface", item: surface };
    }
    const hit = pendingHit;
    if (hit) pendingHit = null;
    return hit ? { kind: "hit", item: hit } : null;
  };

  const isCurrent = (operation: QueueOperation) => {
    if (operation.kind === "surface") return operation.item.isCurrent();
    return operation.item.generation === generation && operation.item.isCurrent();
  };

  const flush = async () => {
    if (disposed || running) return;
    const operation = takeOperation();
    if (!operation) return;
    if (!isCurrent(operation)) return void flush();

    running = true;
    try {
      if (operation.kind === "surface") await flushSurface(operation.item);
      else await flushHit(operation.item);
    } finally {
      running = false;
      void flush();
    }
  };

  return {
    resume() {
      disposed = false;
    },
    enqueueSurface(item: SurfaceQueueItem) {
      generation += 1;
      if (pendingHit && !pendingHit.isCurrent()) pendingHit = null;
      if (pendingHit) pendingHit.generation = generation;
      pendingSurface = item;
      void flush();
    },
    enqueueHit(width: number, height: number, shape: NotchShape, isCurrent: () => boolean) {
      pendingHit = { width, height, shape, generation, isCurrent };
      void flush();
    },
    dispose() {
      disposed = true;
      generation += 1;
      pendingSurface = null;
      pendingHit = null;
    },
  };
}
