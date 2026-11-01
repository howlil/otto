import type { AgentProvider, ProviderReadiness } from "../../platform/tauri";

export type ReadinessSelection = {
  cwd: string;
  provider: AgentProvider;
  model: string | null;
};

type ReadProbe = (selection: ReadinessSelection, requestId: number) => Promise<ProviderReadiness>;
type CancelProbe = (requestId: number) => Promise<void>;
type Scheduler = (run: () => void, delay: number) => () => void;
type Cache = { selection: ReadinessSelection; result: ProviderReadiness; expiresAt: number };

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
  a.cwd === b.cwd && a.provider === b.provider && a.model === b.model;
const cacheMatches = (cache: Cache, next: ReadinessSelection) =>
  cache.selection.cwd === next.cwd &&
  cache.selection.provider === next.provider &&
  (same(cache.selection, next) ||
    (cache.selection.model === null && next.model === cache.result.model));

export class ReadinessProbeController {
  private selection: ReadinessSelection | null = null;
  private cache: Cache | null = null;
  private epoch = 0;
  private cancelTimer: (() => void) | null = null;
  private runningId: number | null = null;
  private disposed = false;
  private readonly read: ReadProbe;
  private readonly cancel: CancelProbe;
  private readonly publish: (result: ProviderReadiness) => void;
  private readonly checking: ProviderReadiness;
  private readonly failed: ProviderReadiness;
  private readonly schedule: Scheduler;
  private readonly now: () => number;

  constructor(
    read: ReadProbe,
    cancel: CancelProbe,
    publish: (result: ProviderReadiness) => void,
    checking: ProviderReadiness,
    failed: ProviderReadiness,
    schedule: Scheduler = defaultScheduler,
    now: () => number = Date.now,
  ) {
    this.read = read;
    this.cancel = cancel;
    this.publish = publish;
    this.checking = checking;
    this.failed = failed;
    this.schedule = schedule;
    this.now = now;
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
    if (this.cache && this.cache.expiresAt > this.now() && cacheMatches(this.cache, next)) {
      this.publish(this.cache.result);
      return;
    }
    this.cache = null;
    this.publish(this.checking);
    const epoch = this.epoch;
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      void this.probe(next, epoch);
    }, 350);
  }

  async refresh(): Promise<void> {
    if (this.disposed || !this.selection) return;
    this.stopPending();
    this.cache = null;
    this.publish(this.checking);
    await this.probe(this.selection, this.epoch);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopPending();
    this.selection = null;
    this.cache = null;
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
  }

  private async probe(selection: ReadinessSelection, epoch: number): Promise<void> {
    const requestId = nextRequestId();
    this.runningId = requestId;
    try {
      const result = await this.read(selection, requestId);
      if (this.disposed || epoch !== this.epoch) return;
      if (result.status === "ready") {
        this.cache = { selection, result, expiresAt: this.now() + 60_000 };
      }
      this.publish(result);
    } catch {
      if (!this.disposed && epoch === this.epoch) this.publish(this.failed);
    } finally {
      if (this.runningId === requestId) this.runningId = null;
    }
  }
}
