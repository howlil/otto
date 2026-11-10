import { setNotchRegion, type NotchRegionPx } from "../../../platform/tauri";

type RegionWrite = { region: NotchRegionPx; report: () => void; applied?: () => void };

export function createGeometryQueue() {
  let pending: RegionWrite | null = null;
  let revision = 0;
  let running = false;
  let disposed = false;
  let generation = 0;
  let confirmed: string | null = null;

  const flush = async () => {
    if (disposed || running || !pending) return;
    const next = pending;
    pending = null;
    const currentGeneration = generation;
    const isActive = () => !disposed && currentGeneration === generation;
    const { sequence: _, ...shape } = next.region;
    const signature = JSON.stringify(shape);
    if (next.region.hostRevision !== revision || signature === confirmed) return;
    running = true;
    try {
      const applied = await setNotchRegion(next.region);
      if (isActive() && applied) {
        confirmed = signature;
        next.applied?.();
      }
    } catch {
      if (isActive()) next.report();
    } finally {
      running = false;
      void flush();
    }
  };

  return {
    resume() {
      disposed = false;
    },
    configure(hostRevision: number) {
      if (revision === hostRevision) return;
      revision = hostRevision;
      generation += 1;
      pending = null;
      confirmed = null;
    },
    enqueue(region: NotchRegionPx, report: () => void, applied?: () => void) {
      pending = { region, report, applied };
      void flush();
    },
    dispose() {
      disposed = true;
      generation += 1;
      pending = null;
      confirmed = null;
    },
  };
}
