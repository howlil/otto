import type { AgentConversationSummary, AgentSnapshot } from "../../platform/tauri";

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

export const HISTORY_TITLE_LIMIT = 120;
const HISTORY_UNAVAILABLE = "Conversation history is unavailable.";

type AgentHistoryDependencies = {
  list: () => Promise<AgentConversationSummary[]>;
  open: (id: string) => Promise<AgentSnapshot>;
  rename: (id: string, title: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  newChat: () => Promise<void>;
  activeId: () => string;
  isLocked: () => boolean;
  publish: (state: HistoryList) => void;
};

export class AgentHistoryController {
  private state: HistoryList = { items: [], loading: false, error: null };
  private listEpoch = 0;
  private openEpoch = 0;
  private disposed = false;
  private readonly deps: AgentHistoryDependencies;

  constructor(deps: AgentHistoryDependencies) {
    this.deps = deps;
  }

  snapshot(): HistoryList {
    return this.state;
  }

  private publish(state: HistoryList) {
    if (this.disposed) return;
    this.state = state;
    this.deps.publish(state);
  }

  async refresh(): Promise<void> {
    const epoch = ++this.listEpoch;
    this.publish({ ...structuredClone(this.state), loading: true, error: null });
    try {
      const items = await this.deps.list();
      if (epoch === this.listEpoch) {
        this.publish({ items, loading: false, error: null });
      }
    } catch {
      if (epoch === this.listEpoch) {
        this.publish({
          ...structuredClone(this.state),
          items: this.state.items,
          loading: false,
          error: HISTORY_UNAVAILABLE,
        });
      }
    }
  }

  async open(id: string): Promise<OpenHistoryOutcome> {
    if (this.disposed || this.deps.isLocked()) return { state: "locked" };
    const epoch = ++this.openEpoch;
    try {
      const snapshot = await this.deps.open(id);
      if (epoch !== this.openEpoch) return { state: "stale" };
      void this.refresh();
      return { state: "ok", snapshot };
    } catch (reason) {
      if (epoch !== this.openEpoch) return { state: "stale" };
      return { state: "error", reason: String(reason) };
    }
  }

  async rename(id: string, title: string): Promise<RenameOutcome> {
    const normalized = title.trim().slice(0, HISTORY_TITLE_LIMIT);
    if (!normalized) return { ok: false, error: "Conversation title is required." };
    try {
      await this.deps.rename(id, normalized);
    } catch (reason) {
      return { ok: false, error: String(reason) };
    }
    await this.refresh();
    return { ok: true };
  }

  async delete(id: string): Promise<DeleteOutcome> {
    try {
      await this.deps.delete(id);
    } catch (reason) {
      return { ok: false, reason: String(reason) };
    }
    if (this.deps.activeId() === id) {
      try {
        await this.deps.newChat();
      } catch (reason) {
        return { ok: false, reason: String(reason) };
      }
    }
    await this.refresh();
    return { ok: true };
  }

  dispose() {
    this.disposed = true;
    this.listEpoch += 1;
    this.openEpoch += 1;
  }
}
