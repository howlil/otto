import { describe, expect, test } from "bun:test";
import { ReadinessProbeController } from "../src/features/agent/readiness-probe.ts";

const checking = { status: "checking", message: "Checking", recovery: "", models: [] };
const ready = { ...checking, status: "ready" };
const failed = { ...checking, status: "unavailable" };
const selection = { cwd: "C:/work", provider: "codex", model: null };

function harness(read) {
  const pending = [];
  const statuses = [];
  const schedule = (run) => {
    const item = { run, cancelled: false };
    pending.push(item);
    return () => { item.cancelled = true; };
  };
  const flush = () => {
    for (const task of pending.splice(0)) if (!task.cancelled) task.run();
  };
  const controller = new ReadinessProbeController(read, (value) => statuses.push(value), checking, failed, schedule);
  return { controller, statuses, flush };
}

describe("Idle provider readiness lifecycle", () => {
  test("Compact never launches a readiness CLI; Agent activation launches once", async () => {
    const calls = [];
    const h = harness(async (value) => { calls.push(value); return ready; });
    h.controller.update(null);
    h.flush();
    expect(calls).toHaveLength(0);
    h.controller.update(selection);
    h.controller.update({ ...selection });
    expect(calls).toHaveLength(0);
    h.flush();
    await Promise.resolve();
    expect(calls).toEqual([selection]);
    expect(h.statuses.at(-1)).toBe(ready);
    h.controller.dispose();
  });

  test("collapse cancels scheduled work and ignores stale in-flight results", async () => {
    let finish;
    const h = harness(() => new Promise((resolve) => { finish = resolve; }));
    h.controller.update(selection);
    h.controller.update(null);
    h.flush();
    expect(finish).toBeUndefined();
    h.controller.update(selection);
    h.flush();
    h.controller.update(null);
    finish(ready);
    await Promise.resolve();
    expect(h.statuses.at(-1)).toBe(checking);
    h.controller.dispose();
  });

  test("manual retry skips debounce; disposed controller ignores asynchronous errors", async () => {
    const calls = [];
    let rejectRequest;
    const h = harness((value) => {
      calls.push(value);
      return new Promise((_, reject) => { rejectRequest = reject; });
    });
    h.controller.update(selection);
    const refresh = h.controller.refresh();
    h.flush();
    expect(calls).toHaveLength(1);
    h.controller.dispose();
    rejectRequest(new Error("provider unavailable"));
    await refresh;
    expect(h.statuses.at(-1)).toBe(checking);
  });

  test("selected model change invalidates previous response", async () => {
    const resolvers = [];
    const h = harness(() => new Promise((resolve) => { resolvers.push(resolve); }));
    h.controller.update(selection);
    h.flush();
    h.controller.update({ ...selection, model: "model-2" });
    h.flush();
    resolvers[0](ready);
    await Promise.resolve();
    expect(h.statuses.at(-1)).toBe(checking);
    resolvers[1](failed);
    await Promise.resolve();
    expect(h.statuses.at(-1)).toBe(failed);
    h.controller.dispose();
  });
});
