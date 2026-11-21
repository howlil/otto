import { describe, expect, test } from "bun:test";
import { ReadinessProbeController } from "../../src/features/agent/model/readiness-probe";

const checking = { status: "checking", message: "Checking" };
const ready = { status: "ready", model: "m1" };
const failed = { status: "unavailable" };
const original = { provider: "codex", model: null };

function harness(read = async () => ready) {
  const tasks = [];
  const cancelled = [];
  const statuses = [];
  let clock = 100;
  const schedule = (run) => {
    const task = { run, cancelled: false };
    tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };
  const controller = new ReadinessProbeController({
    read,
    cancel: async (id) => {
      cancelled.push(id);
    },
    publish: (status) => statuses.push(status),
    checking,
    failed,
    schedule,
    now: () => clock,
  });
  const flush = () => {
    for (const task of tasks.splice(0)) {
      if (!task.cancelled) task.run();
    }
  };
  return { controller, flush, statuses, cancelled, advance: (ms) => { clock += ms; } };
}

describe("Agent readiness lifecycle", () => {
  test("Compact does not start CLI; active selection probes only once", async () => {
    const reads = [];
    const h = harness(async (selection, id) => {
      reads.push([selection, id]);
      return ready;
    });
    h.controller.update(null);
    h.flush();
    expect(reads).toHaveLength(0);
    h.controller.update(original);
    h.controller.update({ ...original });
    h.flush();
    await Promise.resolve();
    expect(reads).toHaveLength(1);
    expect(h.statuses.at(-1)).toBe(ready);
    h.controller.dispose();
  });

  test("verified readiness is reused after reopen and model auto-selection until TTL", async () => {
    let reads = 0;
    const h = harness(async () => {
      reads++;
      return ready;
    });
    h.controller.update(original);
    h.flush();
    await Promise.resolve();
    h.controller.update(null);
    h.controller.update({ ...original, model: "m1" });
    h.flush();
    await Promise.resolve();
    expect(reads).toBe(1);
    expect(h.statuses.at(-1)).toBe(ready);
    h.controller.update(null);
    h.advance(60_001);
    h.controller.update(original);
    h.flush();
    await Promise.resolve();
    expect(reads).toBe(2);
    h.controller.dispose();
  });

  test("collapse cancels in-flight probe and discards late success", async () => {
    let resolve;
    const h = harness(() => new Promise((done) => { resolve = done; }));
    h.controller.update(original);
    h.flush();
    h.controller.update(null);
    expect(h.cancelled).toHaveLength(1);
    resolve(ready);
    await Promise.resolve();
    expect(h.statuses.at(-1)).toBe(checking);
    h.controller.dispose();
  });

  test("selection change cancels superseded probe; stale result is ignored", async () => {
    const resolves = [];
    const h = harness(() => new Promise((resolve) => { resolves.push(resolve); }));
    h.controller.update(original);
    h.flush();
    h.controller.update({ ...original, model: "other" });
    h.flush();
    expect(h.cancelled).toHaveLength(1);
    resolves[0](ready);
    await Promise.resolve();
    expect(h.statuses.at(-1)).toBe(checking);
    resolves[1](failed);
    await Promise.resolve();
    expect(h.statuses.at(-1)).toBe(failed);
    h.controller.dispose();
  });

  test("manual retry bypasses debounce and unmount cancels an active probe", async () => {
    const reads = [];
    let resolve;
    const h = harness((_, id) => {
      reads.push(id);
      return new Promise((done) => { resolve = done; });
    });
    h.controller.update(original);
    const refresh = h.controller.refresh();
    h.flush();
    expect(reads).toHaveLength(1);
    h.controller.dispose();
    expect(h.cancelled).toHaveLength(1);
    resolve(ready);
    await refresh;
    expect(h.statuses.at(-1)).toBe(checking);
  });

  test("switching providers retains prior provider cache and switching models within a cached provider avoids re-probing", async () => {
    const reads = [];
    const codexReady = {
      status: "ready",
      model: "gpt-5-codex",
      imageInput: true,
      thinkingEffort: "medium",
      thinkingEfforts: ["low", "medium", "high"],
      models: [
        {
          id: "gpt-5-codex",
          displayName: "GPT-5 Codex",
          contextWindow: 400_000,
          imageInput: true,
          thinkingEfforts: ["low", "medium", "high"],
          defaultThinkingEffort: "medium",
        },
        {
          id: "gpt-5-mini",
          displayName: "GPT-5 Mini",
          contextWindow: 128_000,
          imageInput: false,
          thinkingEfforts: ["low"],
          defaultThinkingEffort: "low",
        },
      ],
    };
    const claudeReady = {
      status: "ready",
      model: "claude-sonnet-5-5",
      imageInput: true,
      thinkingEffort: "high",
      thinkingEfforts: ["low", "high"],
      models: [
        {
          id: "claude-sonnet-5-5",
          displayName: "Sonnet 5.5",
          contextWindow: 200_000,
          imageInput: true,
          thinkingEfforts: ["low", "high"],
          defaultThinkingEffort: "high",
        },
      ],
    };
    const h = harness(async (selection) => {
      reads.push(selection);
      return selection.provider === "claude" ? claudeReady : codexReady;
    });
    h.controller.update({ provider: "codex", model: null });
    h.flush();
    await Promise.resolve();
    expect(reads).toHaveLength(1);

    h.controller.update({ provider: "codex", model: "gpt-5-mini" });
    h.flush();
    await Promise.resolve();
    expect(reads).toHaveLength(1);
    expect(h.statuses.at(-1)).toMatchObject({
      status: "ready",
      model: "gpt-5-mini",
      imageInput: false,
      thinkingEffort: "low",
    });

    h.controller.update({ provider: "claude", model: null });
    h.flush();
    await Promise.resolve();
    expect(reads).toHaveLength(2);

    h.controller.update({ provider: "codex", model: "gpt-5-mini" });
    h.flush();
    await Promise.resolve();
    expect(reads).toHaveLength(2);
    expect(h.statuses.at(-1).model).toBe("gpt-5-mini");
    h.controller.dispose();
  });

  test("stale cached readiness publishes immediately and revalidates in background without flashing checking", async () => {
    const calls = [];
    const refreshingStates = [];
    const statuses = [];
    const tasks = [];
    const staleReady = { status: "ready", model: "m1", models: [], stale: true };
    const freshReady = { status: "ready", model: "m1", models: [], stale: false };
    const controller = new ReadinessProbeController({
      read: async (selection, _id, force) => {
        calls.push({ selection, force: Boolean(force) });
        return force ? freshReady : staleReady;
      },
      cancel: async () => {},
      publish: (status) => statuses.push(status),
      onRefreshing: (flag) => refreshingStates.push(flag),
      checking,
      failed,
      schedule: (run) => {
        const task = { run, cancelled: false };
        tasks.push(task);
        return () => {
          task.cancelled = true;
        };
      },
      now: () => 100,
    });
    controller.update(original);
    for (const task of tasks.splice(0)) {
      if (!task.cancelled) task.run();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([
      { selection: original, force: false },
      { selection: original, force: true },
    ]);
    expect(statuses).toEqual([checking, staleReady, freshReady]);
    expect(refreshingStates).toContain(true);
    expect(refreshingStates.at(-1)).toBe(false);
    controller.dispose();
  });
});
