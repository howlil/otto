import type { AgentConversationSummary, AgentSnapshot } from "../../platform/tauri";
import { normalizeTitle } from "./history-model";

export type HistoryList = {
  items: AgentConversationSummary[];
  loading: boolean;
  error: string | null;
};

export type OpenHistoryOutcome =
  | { state: "ok"; snapshot: AgentSnapshot }
  | { state: "stale" }
  | { state: "locked" }
  | { state: "error"; reason: string };

export type RenameOutcome = { ok: true } | { ok: false; error: string };
export type DeleteOutcome = { ok: true } | { ok: false; reason: string };

const reasonMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

type AgentHistoryDependencies = {
  list: () => Promise<AgentConversationSummary[]>;
  open: (id: string) => Promise<AgentSnapshot>;
  rename: (id: string, title: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  publish: (state: HistoryList) => void;
};

export class AgentHistoryController {
  private state: HistoryList = { items: [], loading: false, error: null };
  private busy = false;
  private disposed = false;

  constructor(private readonly deps: AgentHistoryDependencies) {}

  snapshot(): HistoryList {
    return this.state;
  }

  private publish(next: HistoryList) {
    if (this.disposed) return;
    this.state = next;
    this.deps.publish(next);
  }

  private begin(): boolean {
    if (this.disposed || this.busy) return false;
    this.busy = true;
    this.publish({ ...this.state, loading: true, error: null });
    return true;
  }

  private finish() {
    this.busy = false;
    this.publish({ ...this.state, loading: false });
  }

  private fail(reason: unknown) {
    this.publish({ ...this.state, error: reasonMessage(reason) });
  }

  async refresh(): Promise<void> {
    if (!this.begin()) return;
    try {
      const items = await this.deps.list();
      this.publish({ ...this.state, items, error: null });
    } catch (reason) {
      this.fail(reason);
    } finally {
      this.finish();
    }
  }

  async open(id: string): Promise<OpenHistoryOutcome> {
    if (!this.begin()) return { state: "locked" };
    try {
      const snapshot = await this.deps.open(id);
      if (this.disposed) return { state: "stale" };
      return { state: "ok", snapshot };
    } catch (reason) {
      if (this.disposed) return { state: "stale" };
      this.fail(reason);
      return { state: "error", reason: reasonMessage(reason) };
    } finally {
      this.finish();
    }
  }

  async rename(id: string, rawTitle: string): Promise<RenameOutcome> {
    if (this.disposed || this.busy) return { ok: false, error: "History is busy." };
    const title = normalizeTitle(rawTitle);
    if (!title) {
      const error = "Conversation title is required.";
      this.fail(error);
      return { ok: false, error };
    }
    if (!this.begin()) return { ok: false, error: "History is busy." };
    try {
      await this.deps.rename(id, title);
      if (this.disposed) return { ok: false, error: "History is unavailable." };
      this.publish({
        ...this.state,
        items: this.state.items.map((item) =>
          item.id === id ? { ...item, title } : item,
        ),
      });
      return { ok: true };
    } catch (reason) {
      this.fail(reason);
      return { ok: false, error: reasonMessage(reason) };
    } finally {
      this.finish();
    }
  }

  async delete(id: string): Promise<DeleteOutcome> {
    if (!this.begin()) return { ok: false, reason: "History is busy." };
    try {
      await this.deps.delete(id);
      if (this.disposed) return { ok: false, reason: "History is unavailable." };
      this.publish({
        ...this.state,
        items: this.state.items.filter((item) => item.id !== id),
      });
      return { ok: true };
    } catch (reason) {
      this.fail(reason);
      return { ok: false, reason: reasonMessage(reason) };
    } finally {
      this.finish();
    }
  }

  dispose() {
    this.disposed = true;
  }
}
