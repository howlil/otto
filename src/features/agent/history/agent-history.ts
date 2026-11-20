import type { AgentConversationSummary, AgentSnapshot } from "../../../platform/tauri";
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
export type ExportOutcome = { ok: true; markdown: string } | { ok: false; reason: string };

const reasonMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

type AgentHistoryDependencies = {
  list: (query?: string) => Promise<AgentConversationSummary[]>;
  open: (id: string) => Promise<AgentSnapshot>;
  rename: (id: string, title: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  deleteAll: () => Promise<void>;
  exportMarkdown?: (id: string) => Promise<string>;
  publish: (state: HistoryList) => void;
};

export class AgentHistoryController {
  private state: HistoryList = { items: [], loading: false, error: null };
  private busy = false;
  private disposed = false;
  private searchSeq = 0;
  private activeQuery = "";

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

  async refresh(query?: string): Promise<void> {
    const nextQuery = query !== undefined ? query : this.activeQuery;
    this.activeQuery = nextQuery;
    if (!this.begin()) return;
    const seq = ++this.searchSeq;
    try {
      const items = await this.deps.list(nextQuery.trim() || undefined);
      if (this.disposed || seq !== this.searchSeq) return;
      this.publish({ ...this.state, items, error: null });
    } catch (reason) {
      if (this.disposed || seq !== this.searchSeq) return;
      this.fail(reason);
    } finally {
      this.finish();
    }
  }

  async search(query: string): Promise<boolean> {
    this.activeQuery = query;
    if (this.disposed) return false;
    const seq = ++this.searchSeq;
    try {
      const items = await this.deps.list(query.trim() || undefined);
      if (this.disposed || seq !== this.searchSeq) return false;
      this.publish({ ...this.state, items, error: null });
      return true;
    } catch (reason) {
      if (this.disposed || seq !== this.searchSeq) return false;
      this.fail(reason);
      return false;
    }
  }

  async exportMarkdown(id: string): Promise<ExportOutcome> {
    if (!this.deps.exportMarkdown) {
      return { ok: false, reason: "Markdown export is unavailable." };
    }
    if (this.disposed || this.busy) return { ok: false, reason: "History is busy." };
    try {
      const markdown = await this.deps.exportMarkdown(id);
      if (this.disposed) return { ok: false, reason: "History is unavailable." };
      return { ok: true, markdown };
    } catch (reason) {
      this.fail(reason);
      return { ok: false, reason: reasonMessage(reason) };
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
        items: this.state.items.map((item) => (item.id === id ? { ...item, title } : item)),
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

  async deleteAll(): Promise<DeleteOutcome> {
    if (!this.begin()) return { ok: false, reason: "History is busy." };
    try {
      await this.deps.deleteAll();
      if (this.disposed) return { ok: false, reason: "History is unavailable." };
      this.publish({ ...this.state, items: [] });
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
