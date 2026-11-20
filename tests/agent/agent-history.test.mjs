import { describe, expect, test } from "bun:test";
import { AgentHistoryController } from "../../src/features/agent/history/agent-history";
import {
  conversationPreview,
  filterConversations,
  groupConversationsByDate,
  updatedLabel,
} from "../../src/features/agent/history/history-model";

const entry = (id) => ({
  id,
  title: `Conversation ${id}`,
  provider: "codex",
  preview: `Question ${id}`,
  updatedAt: 10,
  messageCount: 1,
  interrupted: false,
});
const snapshot = (id) => ({
  runId: 9,
  seq: 2,
  status: "completed",
  provider: "pi",
  conversationId: id,
  threadId: null,
  model: "chosen-model",
  thinkingEffort: null,
  usage: null,
  messages: [{ id: "9:user", role: "user", text: "Question" }],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function harness() {
  const calls = { open: [], rename: [], delete: [], deleteAll: 0, list: 0 };
  let items = [entry("1"), entry("2")];
  let opening;
  let failList = false;
  let failDelete = false;
  const published = [];
  const owner = new AgentHistoryController({
    list: async () => {
      calls.list++;
      if (failList) throw new Error("History unavailable");
      return structuredClone(items);
    },
    open: (id) => {
      calls.open.push(id);
      if (id === "missing") return Promise.reject(new Error("Conversation was not found."));
      return (opening = deferred()).promise.then(() => snapshot(id));
    },
    rename: async (id, title) => {
      calls.rename.push([id, title]);
      if (id === "missing") throw new Error("Conversation was not found.");
      items = items.map((item) => item.id === id ? { ...item, title } : item);
    },
    delete: async (id) => {
      calls.delete.push(id);
      if (failDelete) throw new Error("Deletion failed");
      items = items.filter((item) => item.id !== id);
    },
    deleteAll: async () => {
      calls.deleteAll++;
      if (failDelete) throw new Error("Deletion failed");
      items = [];
    },
    publish: (value) => published.push(structuredClone(value)),
  });
  return {
    owner, published, calls,
    release: () => opening?.resolve(),
    failList: () => { failList = true; },
    failDelete: () => { failDelete = true; },
  };
}

describe("Production history controller", () => {
  test("refresh displays saved records and clears pending", async () => {
    const h = harness();
    await h.owner.refresh();
    expect(h.owner.snapshot()).toEqual({
      items: [entry("1"), entry("2")], loading: false, error: null,
    });
    expect(h.published[0].loading).toBe(true);
  });

  test("refresh failure preserves previous list and offers recovery", async () => {
    const h = harness();
    await h.owner.refresh();
    h.failList();
    await h.owner.refresh();
    expect(h.owner.snapshot().items).toHaveLength(2);
    expect(h.owner.snapshot().error).toBe("History unavailable");
    expect(h.owner.snapshot().loading).toBe(false);
  });

  test("opening a record is exclusive; stale overlap cannot replace the active chat", async () => {
    const h = harness();
    const first = h.owner.open("1");
    expect((await h.owner.open("2")).state).toBe("locked");
    expect(h.calls.open).toEqual(["1"]);
    h.release();
    expect(await first).toEqual({ state: "ok", snapshot: snapshot("1") });
    expect(h.owner.snapshot().loading).toBe(false);
  });

  test("a rejected open returns an actionable error and preserves list", async () => {
    const h = harness();
    await h.owner.refresh();
    const result = await h.owner.open("missing");
    expect(result).toEqual({ state: "error", reason: "Conversation was not found." });
    expect(h.owner.snapshot().items).toHaveLength(2);
    expect(h.owner.snapshot().error).toBe("Conversation was not found.");
  });

  test("disposed owner ignores completed opens and never publishes stale state", async () => {
    const h = harness();
    const inFlight = h.owner.open("1");
    const count = h.published.length;
    h.owner.dispose();
    h.release();
    expect(await inFlight).toEqual({ state: "stale" });
    expect(h.published).toHaveLength(count);
  });

  test("rename normalizes title and only changes row after backend accepts", async () => {
    const h = harness();
    await h.owner.refresh();
    const result = await h.owner.rename("1", "  Updated   title  ");
    expect(result).toEqual({ ok: true });
    expect(h.calls.rename).toEqual([["1", "Updated title"]]);
    expect(h.owner.snapshot().items[0].title).toBe("Updated title");
    expect(h.owner.snapshot().loading).toBe(false);
  });

  test("rename failure does not change title", async () => {
    const h = harness();
    await h.owner.refresh();
    const result = await h.owner.rename("missing", "New title");
    expect(result).toEqual({ ok: false, error: "Conversation was not found." });
    expect(h.owner.snapshot().items[0].title).toBe("Conversation 1");
  });

  test("delete waits for backend acceptance and retains rows after failure", async () => {
    const h = harness();
    await h.owner.refresh();
    h.failDelete();
    expect(await h.owner.delete("1")).toEqual({ ok: false, reason: "Deletion failed" });
    expect(h.owner.snapshot().items).toHaveLength(2);
  });

  test("delete refreshes visible rows without calling a second new-chat command", async () => {
    const h = harness();
    await h.owner.refresh();
    expect(await h.owner.delete("1")).toEqual({ ok: true });
    expect(h.owner.snapshot().items.map((item) => item.id)).toEqual(["2"]);
    expect(h.calls.delete).toEqual(["1"]);
  });

  test("delete all clears visible rows only after backend acceptance", async () => {
    const h = harness();
    await h.owner.refresh();
    expect(await h.owner.deleteAll()).toEqual({ ok: true });
    expect(h.owner.snapshot().items).toEqual([]);
    expect(h.calls.deleteAll).toBe(1);
  });

  test("delete all failure preserves every conversation", async () => {
    const h = harness();
    await h.owner.refresh();
    h.failDelete();
    expect(await h.owner.deleteAll()).toEqual({ ok: false, reason: "Deletion failed" });
    expect(h.owner.snapshot().items).toHaveLength(2);
  });

  test("mutation requests are rejected while open is pending", async () => {
    const h = harness();
    const opening = h.owner.open("1");
    expect(await h.owner.rename("2", "Title")).toEqual({ ok: false, error: "History is busy." });
    expect(await h.owner.delete("2")).toEqual({ ok: false, reason: "History is busy." });
    expect(h.calls.rename).toEqual([]);
    expect(h.calls.delete).toEqual([]);
    expect(await h.owner.deleteAll()).toEqual({ ok: false, reason: "History is busy." });
    expect(h.calls.deleteAll).toBe(0);
    h.release();
    await opening;
  });

  test("updatedLabel formats Unix-second timestamps relative to Date.now milliseconds", () => {
    const nowMs = Date.UTC(2026, 4, 15, 12, 0, 0);
    const fiveMinutesAgoSecs = Math.floor(nowMs / 1000) - 300;
    const fiveMinutesAgoMs = nowMs - 300_000;
    expect(updatedLabel(fiveMinutesAgoSecs, nowMs)).toBe("5m ago");
    expect(updatedLabel(fiveMinutesAgoMs, nowMs)).toBe("5m ago");
  });

  test("filterConversations matches across title, preview snippet, and provider name", () => {
    const records = [
      { ...entry("1"), title: "Rust notes", preview: "Explain ownership and borrowing", provider: "claude" },
      { ...entry("2"), title: "Calculus help", preview: "Chain rule derivative", provider: "codex" },
    ];
    expect(filterConversations(records, "borrowing").map((item) => item.id)).toEqual(["1"]);
    expect(filterConversations(records, "claude ownership").map((item) => item.id)).toEqual(["1"]);
    expect(filterConversations(records, "codex").map((item) => item.id)).toEqual(["2"]);
  });

  test("conversationPreview hides redundant previews and surfaces original prompt when renamed", () => {
    expect(conversationPreview({ ...entry("1"), title: "Question 1", preview: "Question 1" })).toBeNull();
    expect(
      conversationPreview({ ...entry("1"), title: "My custom title", preview: "Original first prompt" }),
    ).toBe("Original first prompt");
  });

  test("groupConversationsByDate buckets items into Today, Yesterday, Earlier this week, and Older", () => {
    const nowMs = Date.UTC(2026, 4, 15, 18, 0, 0);
    const items = [
      { ...entry("today"), updatedAt: nowMs - 3_600_000 },
      { ...entry("yesterday"), updatedAt: nowMs - 30 * 3_600_000 },
      { ...entry("week"), updatedAt: nowMs - 4 * 86_400_000 },
      { ...entry("older"), updatedAt: nowMs - 14 * 86_400_000 },
    ];
    const groups = groupConversationsByDate(items, nowMs);
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
      ["Earlier this week", ["week"]],
      ["Older", ["older"]],
    ]);
  });

  test("controller search ignores stale out-of-order responses and export failure keeps history intact", async () => {
    const first = deferred();
    const second = deferred();
    let calls = 0;
    const owner = new AgentHistoryController({
      list: async (query) => {
        calls += 1;
        if (calls === 1) {
          await first.promise;
          return [entry("stale")];
        }
        await second.promise;
        return [entry(`fresh-${query}`)];
      },
      open: async (id) => snapshot(id),
      rename: async () => {},
      delete: async () => {},
      deleteAll: async () => {},
      exportMarkdown: async (id) => {
        if (id === "broken") throw new Error("Export failed");
        return `# Export ${id}`;
      },
      publish: () => {},
    });

    const slowSearch = owner.search("old");
    const fastSearch = owner.search("dijkstra");
    second.resolve();
    expect(await fastSearch).toBe(true);
    first.resolve();
    expect(await slowSearch).toBe(false);
    expect(owner.snapshot().items.map((item) => item.id)).toEqual(["fresh-dijkstra"]);

    expect(await owner.exportMarkdown("fresh-dijkstra")).toEqual({
      ok: true,
      markdown: "# Export fresh-dijkstra",
    });
    expect(await owner.exportMarkdown("broken")).toEqual({
      ok: false,
      reason: "Export failed",
    });
    expect(owner.snapshot().items.map((item) => item.id)).toEqual(["fresh-dijkstra"]);
    expect(owner.snapshot().error).toBe("Export failed");
  });
});
