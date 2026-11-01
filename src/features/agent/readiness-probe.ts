import type { AgentProvider, ProviderReadiness } from "../../platform/tauri";

export type ReadinessSelection = {
  cwd: string;
  provider: AgentProvider;
  model: string | null;
};

type Reader = (selection: ReadinessSelection) => Promise<ProviderReadiness>;
type Scheduler = (run: () => void, delay: number) => () => void;

const schedule: Scheduler = (run, delay) => {
  const timer = setTimeout(run, delay);
  return () => clearTimeout(timer);
};

function sameSelection(a: ReadinessSelection | null, b: ReadinessSelection | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.cwd === b.cwd &&
      a.provider === b.provider &&
      a.model === b.model)
  );
}

export class ReadinessProbeController {
  private selection: ReadinessSelection | null = null;
  private generation = 0;
  private cancel: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly read: Reader,
    private readonly publish: (status: ProviderReadiness) => void,
    private readonly checking: ProviderReadiness,
    private readonly failed: ProviderReadiness,
    private readonly scheduleProbe: Scheduler = schedule,
  ) {}

  update(next: ReadinessSelection | null): void {
    if (this.disposed || sameSelection(this.selection, next)) return;
    this.invalidate();
    this.selection = next;
    this.publish(this.checking);
    if (next) {
      const generation = this.generation;
      this.cancel = this.scheduleProbe(() => {
        this.cancel = null;
        void this.readSelection(next, generation);
      }, 350);
    }
  }

  async refresh(): Promise<void> {
    if (this.disposed || !this.selection) return;
    this.invalidate();
    this.publish(this.checking);
    await this.readSelection(this.selection, this.generation);
  }

  dispose(): void {
    this.invalidate();
    this.disposed = true;
    this.selection = null;
  }

  private invalidate(): void {
    this.generation += 1;
    this.cancel?.();
    this.cancel = null;
  }

  private async readSelection(selection: ReadinessSelection, generation: number): Promise<void> {
    try {
      const status = await this.read(selection);
      if (!this.disposed && generation === this.generation) this.publish(status);
    } catch {
      if (!this.disposed && generation === this.generation) this.publish(this.failed);
    }
  }
}
