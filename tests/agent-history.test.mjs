import { describe, expect, test } from "bun:test";
import { AgentHistoryController, HISTORY_TITLE_LIMIT } from "../src/features/agent/agent-history.ts";

const summary = (id) => ({
  id,
  title: `Conversation ${id}`,
  provider: "codex",
  preview: `question ${id}`,
  updatedAt: 100 + Number(id),
  messageCount: 2,
  interrupted: false,
});
const snapshotFor = (id) => ({
  runId: 9,
  seq: 3,
  status: "completed",
  provider: "codex",
  conversationId: id,
  threadId: null,
  model: "model-9",
  thinkingEffort: "high",
  usage: null,
  messages: [{ id: "9:user", role: "user", text: `question ${id}` }],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
});

function harness({ initialItems = ["1", "2"], broken = false, locked = false } = {}) {
  const published = [];
  let items = [...initialItems];
  let listCalls = 0;
  const calls = { open: [], rename: [], delete: [], newChat: [] };
  const deferred = [];
  let listGate = null;
  let active = "";
  const controller = new AgentHistoryController({
    list: async () => {
      listCalls += 1;
      const gate = listCalls === 1 && !broken ? listGate : null;
      if (gate) await gate;
      if (broken) throw new Error("history file unreadable");
      return items
        .map((id) => summary(id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((item) => structuredClone(item));
    },
    open: (id) => {
      calls.open.push(id);
      return new Promise((resolve, reject) => {
        const settle = (payload) =>
          id === "broken-open"
            ? reject(new Error("record missing"))
            : resolve(snapshotFor(id));
        deferred.push([id, settle]);
      });
    },
    rename: async (id, title) => {
      calls.rename.push([id, title]);
      if (id === "broken-open") throw new Error("record missing");
      items = items.map((item) => (item === id ? { ...summary(id), title } : item));
    },
    delete: async (id) => {
      calls.delete.push(id);
      if (id === "broken-open") throw new Error("record missing");
      items = items.filter((item) => item !== id);
    },
    newChat: async () => {
      calls.newChat.push(1);
    },
    activeId: () => active,
    isLocked: () => locked,
    publish: (next) => published.push(structuredClone(next)),
  });
  const drain = async (turns = 8) => {
    for (let index = 0; index < turns; index += 1) await Promise.resolve();
  };
  const release = (id = "") => {
    for (const [openId, settle] of deferred.splice(0)) {
      if (!id || openId === id) settle(snapshotFor(openId));
    }
  };
  const deferFirstList = () => {
    listGate = new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  };
  return {
    controller,
    published,
    calls,
    drain,
    release,
    deferFirstList,
    setActive: (id) => {
      active = id;
    },
  };
}

describe("Agent history list", () => {
  test("refresh publishes a loading state then the sorted items", async () => {
    const h = harness();
    const done = h.controller.refresh();
    expect(h.published.at(-1)).toEqual({ items: [], loading: true, error: null });
    await h.drain();
    await done;
    expect(h.published.at(-1)).toEqual({
      items: [summary("2"), summary("1")],
      loading: false,
      error: null,
    });
  });

  test("an older refresh result never overwrites a newer one", async () => {
    const h = harness();
    h.deferFirstList();
    h.controller.refresh();
    h.controller.refresh();
    await h.drain();
    expect(h.published.filter((state) => !state.loading)).toHaveLength(1);
    expect(h.published.at(-1).items).toHaveLength(2);
  });

  test("failed refresh keeps the last list and reports unavailability", async () => {
    const h = harness({ broken: true });
    await h.controller.refresh();
    expect(h.published.at(-1)).toEqual({
      items: [],
      loading: false,
      error: "Conversation history is unavailable.",
    });
  });

  test("an empty store list is a clean empty state", async () => {
    const h = harness({ initialItems: [] });
    await h.controller.refresh();
    expect(h.published.at(-1)).toEqual({ items: [], loading: false, error: null });
  });
});

describe("Agent history open", () => {
  test("locked runtime rejects open without touching the backend", async () => {
    const h = harness({ locked: true });
    const outcome = await h.controller.open("1");
    expect(outcome.state).toBe("locked");
    expect(h.calls.open).toEqual([]);
  });

  test("open accepts the newest snapshot and refreshes the list", async () => {
    const h = harness();
    const promise = h.controller.open("1");
    h.release("1");
    const outcome = await promise;
    expect(outcome.state).toBe("ok");
    expect(outcome.snapshot.conversationId).toBe("1");
    expect(outcome.snapshot.model).toBe("model-9");
    expect(h.calls.open).toEqual(["1"]);
    expect(h.published.at(-1).items).toHaveLength(2);
  });

  test("a stale resolved open never reaches caller state or publishes again", async () => {
    const h = harness();
    const stale = h.controller.open("1");
    h.release("2");
    const fresh = await h.controller.open("2");
    expect(fresh).toEqual({ state: "ok", snapshot: snapshotFor("2") });
    const publishedBefore = h.published.length;
    h.release("1");
    expect((await stale).state).toBe("stale");
    h.release();
    await h.drain();
    expect(h.published.length).toBe(publishedBefore);
  });

  test("opening a missing record reports a request error", async () => {
    const h = harness();
    const outcome = await h.controller.open("broken-open");
    expect(outcome.state).toBe("error");
    expect(outcome.reason).toBe("record missing");
  });
});

describe("Agent history rename", () => {
  test("empty titles are rejected without touching the backend", async () => {
    const h = harness();
    const outcome = await h.controller.rename("1", "   ");
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("Conversation title is required.");
    expect(h.calls.rename).toEqual([]);
  });

  test("rename trims the title, stores it and refreshes the list", async () => {
    const h = harness();
    const outcome = await h.controller.rename("1", "  Compact history  ");
    expect(outcome).toEqual({ ok: true });
    expect(h.calls.rename).toEqual([["1", "Compact history"]]);
    expect(h.published.at(-1).items[0].title).toBe("Compact history");
  });

  test("rename caps the stored title length", async () => {
    const h = harness();
    await h.controller.rename("1", "x".repeat(150));
    expect(h.calls.rename[0][1]).toBe("x".repeat(HISTORY_TITLE_LIMIT));
  });

  test("rename failure surfaces the backend reason", async () => {
    const h = harness();
    const outcome = await h.controller.rename("broken-open", "still fine");
    expect(outcome).toEqual({ ok: false, error: "record missing" });
  });
});

describe("Agent history delete", () => {
  test("deleting the active record starts a fresh chat, other records keep the session", async () => {
    const h = harness();
    h.setActive("2");
    await h.controller.delete("2");
    expect(h.calls.delete).toEqual(["2"]);
    expect(h.calls.newChat).toEqual([1]);

    const other = harness();
    await other.controller.delete("1");
    expect(other.calls.delete).toEqual(["1"]);
    expect(other.calls.newChat).toEqual([]);
  });

  test("delete refreshes the remaining list", async () => {
    const h = harness();
    await h.controller.delete("1");
    expect(h.published.at(-1).items.map((item) => item.id)).toEqual(["2"]);
  });

  test("deleting a missing record reports a request error", async () => {
    const h = harness();
    const outcome = await h.controller.delete("broken-open");
    expect(outcome).toEqual({ ok: false, reason: "record missing" });
  });
});
