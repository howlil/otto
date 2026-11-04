import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const idle = {
  runId: 0,
  seq: 0,
  status: "idle",
  provider: "codex",
  threadId: null,
  model: null,
  thinkingEffort: null,
  usage: null,
  messages: [],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
};

const readyReadiness = {
  status: "ready",
  message: "Pi is ready.",
  recovery: "",
  imageInput: false,
  imageTransport: true,
  toolFreeAdmission: true,
  model: "model-a",
  models: [
    {
      id: "model-a",
      displayName: "Model A",
      contextWindow: 1000,
      imageInput: false,
      thinkingEfforts: ["off", "high"],
      defaultThinkingEffort: "high",
    },
    {
      id: "model-b",
      displayName: "Model B",
      contextWindow: 2000,
      imageInput: false,
      thinkingEfforts: ["low", "high"],
      defaultThinkingEffort: "low",
    },
  ],
  thinkingEffort: "high",
  thinkingEfforts: ["off", "high"],
};

let selections: Array<[string | null, string | null]> = [];
let runs: Array<{ text: string; provider: string; model: string | null; effort: string | null }> =
  [];
let selectionError: string | null = null;
let pushSnapshot: ((snapshot: unknown) => void) | null = null;

mock.module("../src/platform/tauri", () => ({
  nativeAvailable: true,
  getAgentSnapshot: async () => idle,
  subscribeAgent: async (onSnapshot: (snapshot: unknown) => void) => {
    pushSnapshot = onSnapshot;
    return { channel: { onmessage: null }, unsubscribe: async () => {} };
  },
  getAgentReadiness: async () => readyReadiness,
  cancelAgentReadiness: async () => {},
  selectAgentProvider: async () => {},
  selectAgentRuntimeOptions: async (model: string | null, effort: string | null) => {
    if (selectionError) throw new Error(selectionError);
    selections.push([model, effort]);
  },
  askAgent: async (
    text: string,
    provider: string,
    options: { model: string | null; thinkingEffort: string | null },
  ) => {
    runs.push({ text, provider, model: options.model, effort: options.thinkingEffort });
    return { runId: 4 };
  },
  stopCodex: async () => {},
  newAgentChat: async () => {},
  configureCaptureShortcut: async () => {},
  configureCaptureSource: async () => {},
  captureAgentNow: async () => {},
  getCaptureTargetTitle: async () => "",
  listAgentHistory: async () => [],
  openAgentHistory: async () => idle,
  renameAgentHistory: async () => {},
  deleteAgentHistory: async () => {},
  deleteAllAgentHistory: async () => {},
}));

const { useAgent } = await import("../src/features/agent/useAgent");

const awaitReady = async (hook: { result: { current: { readiness: { status: string } } } }) => {
  await waitFor(() => {
    expect(hook.result.current.readiness.status).toBe("ready");
  });
};

const mount = async () => {
  const hook = renderHook(() => useAgent(true));
  await awaitReady(hook);
  return hook;
};

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  cleanup();
  selections = [];
  runs = [];
  selectionError = null;
  pushSnapshot = null;
});

describe("Agent runtime selection reaches the next run", () => {
  test("the confirmed model and thinking effort are sent with the prompt", async () => {
    const hook = await mount();
    await act(async () => {
      await hook.result.current.setProvider("pi");
    });
    await awaitReady(hook);
    await act(async () => {
      await hook.result.current.setModel("model-b");
    });
    expect(selections).toEqual([["model-b", "low"]]);
    expect(hook.result.current.model).toBe("model-b");
    expect(hook.result.current.thinkingEffort).toBe("low");

    await act(async () => {
      hook.result.current.setDraft("Explain ownership");
    });
    await act(async () => {
      await hook.result.current.send();
    });
    expect(runs).toEqual([
      { text: "Explain ownership", provider: "pi", model: "model-b", effort: "low" },
    ]);
  });

  test("a rejected runtime selection keeps the previous model", async () => {
    const hook = await mount();
    await act(async () => {
      await hook.result.current.setProvider("pi");
    });
    await awaitReady(hook);
    await act(async () => {
      await hook.result.current.setModel("model-b");
    });
    const accepted = hook.result.current.model;
    selectionError = "Runtime selection changed while readiness was checked. Retry.";
    await act(async () => {
      await hook.result.current.setModel("model-a");
    });
    expect(hook.result.current.model).toBe(accepted);
    expect(hook.result.current.error).toContain(selectionError as string);
  });

  test("an active run locks the runtime selection", async () => {
    const hook = await mount();
    await act(async () => {
      await hook.result.current.setProvider("pi");
    });
    await act(async () => {
      pushSnapshot?.({ ...idle, runId: 3, seq: 2, status: "streaming", provider: "pi" });
    });
    await waitFor(() => {
      expect(hook.result.current.busy).toBe(true);
    });
    const before = hook.result.current.model;
    await act(async () => {
      await hook.result.current.setModel("model-b");
    });
    expect(selections).toEqual([]);
    expect(hook.result.current.model).toBe(before);
  });
});
