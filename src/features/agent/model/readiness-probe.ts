import type { AgentProvider, ProviderReadiness } from "../../../platform/tauri";

export type ReadinessSelection = {
  provider: AgentProvider;
  model: string | null;
};

type ReadProbe = (
  selection: ReadinessSelection,
  requestId: number,
  force?: boolean,
) => Promise<ProviderReadiness>;
type CancelProbe = (requestId: number) => Promise<void>;
type Scheduler = (run: () => void, delay: number) => () => void;
type Cache = { selection: ReadinessSelection; result: ProviderReadiness; expiresAt: number };
type ReadinessProbeDependencies = {
  read: ReadProbe;
  cancel: CancelProbe;
  publish: (result: ProviderReadiness) => void;
  onRefreshing?: (refreshing: boolean) => void;
  checking: ProviderReadiness;
  failed: ProviderReadiness;
  schedule?: Scheduler;
  now?: () => number;
};

let lastRequestId = 0;
const nextRequestId = () => {
  lastRequestId = Math.max(lastRequestId + 1, Date.now() * 1024);
  return lastRequestId;
};
const defaultScheduler: Scheduler = (run, delay) => {
  const timer = setTimeout(run, delay);
  return () => clearTimeout(timer);
};
const same = (a: ReadinessSelection, b: ReadinessSelection) =>
  a.provider === b.provider && a.model === b.model;
const cacheMatches = (cache: Cache, next: ReadinessSelection) =>
  cache.selection.provider === next.provider &&
  (same(cache.selection, next) ||
    (cache.selection.model === null && next.model === cache.result.model));

function projectCachedModel(result: ProviderReadiness, model: string): ProviderReadiness | null {
  if (result.status !== "ready" || !Array.isArray(result.models)) return null;
  const selected = result.models.find((option) => option.id === model);
  if (!selected) return null;
  return {
    ...result,
    model: selected.id,
    imageInput: selected.imageInput,
    thinkingEffort: selected.defaultThinkingEffort,
    thinkingEfforts: selected.thinkingEfforts,
  };
}

export class ReadinessProbeController {
  private selection: ReadinessSelection | null = null;
  private readonly cache = new Map<AgentProvider, Cache>();
  private epoch = 0;
  private cancelTimer: (() => void) | null = null;
  private runningId: number | null = null;
  private disposed = false;
  private readonly read: ReadProbe;
  private readonly cancel: CancelProbe;
  private readonly publish: (result: ProviderReadiness) => void;
  private readonly onRefreshing?: (refreshing: boolean) => void;
  private readonly checking: ProviderReadiness;
  private readonly failed: ProviderReadiness;
  private readonly schedule: Scheduler;
  private readonly now: () => number;

  constructor(deps: ReadinessProbeDependencies) {
    this.read = deps.read;
    this.cancel = deps.cancel;
    this.publish = deps.publish;
    this.onRefreshing = deps.onRefreshing;
    this.checking = deps.checking;
    this.failed = deps.failed;
    this.schedule = deps.schedule ?? defaultScheduler;
    this.now = deps.now ?? Date.now;
  }

  update(next: ReadinessSelection | null): void {
    if (this.disposed || (this.selection === null && next === null)) return;
    if (this.selection && next && same(this.selection, next)) return;
    this.stopPending();
    this.selection = next;
    if (!next) {
      this.publish(this.checking);
      return;
    }
    const hit = this.resolveCached(next);
    if (hit) {
      this.publish(hit);
      return;
    }
    this.publish(this.checking);
    const epoch = this.epoch;
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      void this.probe(next, epoch, false, false);
    }, 120);
  }

  private resolveCached(next: ReadinessSelection): ProviderReadiness | null {
    const cached = this.cache.get(next.provider);
    if (!cached) return null;
    if (cached.expiresAt <= this.now()) {
      this.cache.delete(next.provider);
      return null;
    }
    if (cacheMatches(cached, next)) return cached.result;
    if (next.model === null) return null;
    const projected = projectCachedModel(cached.result, next.model);
    if (!projected) return null;
    this.cache.set(next.provider, {
      selection: next,
      result: projected,
      expiresAt: cached.expiresAt,
    });
    return projected;
  }

  async refresh(): Promise<void> {
    if (this.disposed || !this.selection) return;
    this.stopPending();
    const existing = this.cache.get(this.selection.provider);
    const keepVisible = existing?.result.status === "ready";
    this.cache.delete(this.selection.provider);
    if (!keepVisible) {
      this.publish(this.checking);
    }
    await this.probe(this.selection, this.epoch, true, keepVisible);
  }

  clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopPending();
    this.selection = null;
    this.cache.clear();
    this.disposed = true;
  }

  private stopPending(): void {
    this.epoch += 1;
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.runningId !== null) {
      void this.cancel(this.runningId).catch(() => undefined);
      this.runningId = null;
    }
    this.onRefreshing?.(false);
  }

  private async probe(
    selection: ReadinessSelection,
    epoch: number,
    force: boolean,
    silent: boolean,
  ): Promise<void> {
    const requestId = nextRequestId();
    this.runningId = requestId;
    if (silent) this.onRefreshing?.(true);
    try {
      const result = await this.read(selection, requestId, force);
      if (this.disposed || epoch !== this.epoch) return;
      if (result.status === "ready") {
        this.cache.set(selection.provider, {
          selection,
          result,
          expiresAt: this.now() + 60_000,
        });
      }
      this.publish(result);
      if (!force && result.status === "ready" && result.stale) {
        void this.probe(selection, epoch, true, true);
        return;
      }
    } catch {
      if (!this.disposed && epoch === this.epoch && !silent) this.publish(this.failed);
    } finally {
      if (this.runningId === requestId) {
        this.runningId = null;
        if (silent) this.onRefreshing?.(false);
      }
    }
  }
}
