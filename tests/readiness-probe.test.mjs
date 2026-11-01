import { describe, expect, test } from "bun:test";
import { ReadinessProbeController } from "../src/features/agent/readiness-probe.ts";

const checking = { status: "checking", message: "Checking" };
const ready = { status: "ready", model: "m1" };
const failed = { status: "unavailable" };
const original = { cwd: "C:/work", provider: "codex", model: null };

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
  const controller = new ReadinessProbeController(
    read,
    async (id) => {
      cancelled.push(id);
    },
    (status) => statuses.push(status),
    checking,
    failed,
    schedule,
    () => clock,
  );
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
});
