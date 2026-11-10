import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AgentSnapshot } from "../src/platform/tauri";

const idle: AgentSnapshot = {
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
let readSnapshot = async () => idle;
let providerReadiness = readyReadiness;
let changeProvider = async () => {};
let changeRuntime = async () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, resolve, reject };
}

mock.module("../src/platform/tauri", () => ({
  nativeAvailable: true,
  codexInstalled: async () => false,
  getCodexReadiness: async () => readyReadiness,
  getAgentSnapshot: () => readSnapshot(),
  subscribeAgent: async (onSnapshot: (snapshot: unknown) => void) => {
    pushSnapshot = onSnapshot;
    return { channel: { onmessage: null }, unsubscribe: async () => {} };
  },
  getAgentReadiness: async (_provider: string, _requestId: number, model: string | null) => ({
    ...providerReadiness,
    model: model ?? providerReadiness.model,
    thinkingEffort: model === "model-b" ? "low" : providerReadiness.thinkingEffort,
  }),
  cancelAgentReadiness: async () => {},
  selectAgentProvider: () => changeProvider(),
  selectAgentRuntimeOptions: async (model: string | null, effort: string | null) => {
    if (selectionError) throw new Error(selectionError);
    await changeRuntime();
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

const awaitReady = async (hook: {
  result: { current: { readiness: { status: string; model: string | null }; model: string | null } };
}) => {
  await waitFor(() => {
    expect(hook.result.current.readiness.status).toBe("ready");
    expect(hook.result.current.readiness.model).toBe(hook.result.current.model);
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
  readSnapshot = async () => idle;
  providerReadiness = readyReadiness;
  changeProvider = async () => {};
  changeRuntime = async () => {};
});

describe("Agent runtime selection reaches the next run", () => {
  test("does not submit when provider readiness is unavailable", async () => {
    providerReadiness = {
      ...readyReadiness,
      status: "missing",
      message: "Pi CLI was not found.",
      recovery: "Install Pi, then Retry.",
    };
    const hook = renderHook(() => useAgent(true));
    await waitFor(() => {
      expect(hook.result.current.readiness.status).toBe("missing");
    });
    await act(async () => hook.result.current.setDraft("Keep this draft"));
    await act(async () => { await hook.result.current.send(); });
    expect(runs).toEqual([]);
    expect(hook.result.current.draft).toBe("Keep this draft");
  });

  test("a current bootstrap restores the native provider and model", async () => {
    readSnapshot = async () => ({
      ...idle, provider: "pi", model: "model-b", thinkingEffort: "low", seq: 7,
    });
    const hook = await mount();
    expect(hook.result.current.snapshot.seq).toBe(7);
    expect(hook.result.current.provider).toBe("pi");
    expect(hook.result.current.model).toBe("model-b");
    expect(hook.result.current.thinkingEffort).toBe("low");
    await act(async () => pushSnapshot?.({ ...idle, seq: 6 }));
    expect(hook.result.current.snapshot.seq).toBe(7);
  });

  test("an in-flight model change excludes provider changes, sends and conversation resets", async () => {
    const hook = await mount();
    await act(async () => { await hook.result.current.setProvider("pi"); });
    await awaitReady(hook);
    await act(async () => hook.result.current.setDraft("Wait for the model"));
    const switching = deferred<void>();
    changeRuntime = () => switching.promise;
    let pending!: Promise<void>;
    let reset: boolean | undefined;
    await act(async () => {
      pending = hook.result.current.setModel("model-b");
      await hook.result.current.setProvider("agy");
      await hook.result.current.send();
      reset = await hook.result.current.newSession();
    });
    expect(reset).toBe(false);
    expect(hook.result.current.provider).toBe("pi");
    expect(hook.result.current.locked).toBe(true);
    expect(hook.result.current.draft).toBe("Wait for the model");
    expect(runs).toEqual([]);
    await act(async () => { switching.resolve(); await pending; });
    expect(hook.result.current.locked).toBe(false);
    expect(hook.result.current.model).toBe("model-b");
    await awaitReady(hook);
    await act(async () => { await hook.result.current.send(); });
    expect(runs).toEqual([
      { text: "Wait for the model", provider: "pi", model: "model-b", effort: "low" },
    ]);
  });

  test("a delayed bootstrap cannot overwrite a newer provider or runtime selection", async () => {
    const bootstrap = deferred<typeof idle>();
    readSnapshot = () => bootstrap.promise;
    const hook = await mount();
    await act(async () => {
      await hook.result.current.setProvider("pi");
    });
    await awaitReady(hook);
    await act(async () => {
      await hook.result.current.setModel("model-b");
      pushSnapshot?.({ ...idle, provider: "pi", model: "model-b", seq: 10 });
    });
    await act(async () => bootstrap.resolve(idle));
    expect(hook.result.current.snapshot.provider).toBe("pi");
    expect(hook.result.current.provider).toBe("pi");
    expect(hook.result.current.model).toBe("model-b");
    expect(hook.result.current.thinkingEffort).toBe("low");
    await act(async () => hook.result.current.setDraft("Use the confirmed runtime"));
    await awaitReady(hook);
    await act(async () => { await hook.result.current.send(); });
    expect(runs).toEqual([
      { text: "Use the confirmed runtime", provider: "pi", model: "model-b", effort: "low" },
    ]);
  });

  test("provider changes immediately guard submission and model changes before a rerender", async () => {
    const hook = await mount();
    await act(async () => hook.result.current.setDraft("Keep this draft"));
    const selectedModel = hook.result.current.model;
    const switching = deferred<void>();
    changeProvider = () => switching.promise;
    let pending!: Promise<void>;
    await act(async () => {
      pending = hook.result.current.setProvider("pi");
      await hook.result.current.send();
      await hook.result.current.setModel("model-b");
    });
    expect(hook.result.current.draft).toBe("Keep this draft");
    expect(hook.result.current.model).toBe(selectedModel);
    expect(hook.result.current.busy).toBe(true);
    expect(hook.result.current.locked).toBe(true);
    expect(runs).toEqual([]);
    await act(async () => { switching.resolve(); await pending; });
    await awaitReady(hook);
    expect(hook.result.current.provider).toBe("pi");
    expect(hook.result.current.busy).toBe(false);
    await act(async () => { await hook.result.current.send(); });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.provider).toBe("pi");
  });

  test("a rejected provider change keeps the draft and selection and unlocks retry", async () => {
    const hook = await mount();
    await act(async () => hook.result.current.setDraft("Do not lose this"));
    const selectedModel = hook.result.current.model;
    const switching = deferred<void>();
    changeProvider = () => switching.promise;
    let pending!: Promise<void>;
    await act(async () => { pending = hook.result.current.setProvider("pi"); });
    expect(hook.result.current.locked).toBe(true);
    await act(async () => {
      switching.reject(new Error("Provider switch failed"));
      await pending;
    });
    expect(hook.result.current.provider).toBe("codex");
    expect(hook.result.current.model).toBe(selectedModel);
    expect(hook.result.current.draft).toBe("Do not lose this");
    expect(hook.result.current.error).toContain("Provider switch failed");
    expect(hook.result.current.locked).toBe(false);
    changeProvider = async () => {};
    await act(async () => { await hook.result.current.setProvider("pi"); });
    expect(hook.result.current.provider).toBe("pi");
    expect(hook.result.current.error).toBeNull();
  });

  test("the confirmed model and thinking effort are sent with the prompt", async () => {
    const hook = await mount();
    await act(async () => {
      await hook.result.current.setProvider("pi");
    });
    await awaitReady(hook);
    await act(async () => {
      await hook.result.current.setModel("model-b");
    });
    await awaitReady(hook);
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
