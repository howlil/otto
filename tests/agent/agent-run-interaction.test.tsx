import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const channels: Array<{ onmessage: ((value: unknown) => void) | null }> = [];
const askPayloads: Array<Record<string, unknown>> = [];
const guidancePayloads: Array<Record<string, unknown>> = [];
let deferredAsk: Promise<{ runId: number }> | null = null;
let resolveDeferredAsk: ((value: { runId: number }) => void) | null = null;

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, payload: unknown) => {
    if (command === "agent_subscribe") {
      channels.push((payload as { onEvent: { onmessage: ((value: unknown) => void) | null } }).onEvent);
      return channels.length;
    }
    if (command === "agent_provider_readiness") {
      return {
        status: "ready",
        message: "Codex ready",
        recovery: "",
        imageInput: true,
        imageTransport: true,
        model: "gpt-5-codex",
        models: [{ id: "gpt-5-codex", label: "gpt-5-codex", imageInput: true, thinkingEfforts: ["medium"] }],
        thinkingEffort: "medium",
        thinkingEfforts: ["medium"],
      };
    }
    if (command === "agent_set_guidance") {
      guidancePayloads.push(payload as Record<string, unknown>);
      return null;
    }
    if (command === "agent_ask") {
      askPayloads.push(payload as Record<string, unknown>);
      if (deferredAsk) return deferredAsk;
      return { runId: 11 };
    }
    if (command === "agent_history_list") return [];
    if (command === "overlay_set_capture_protection") {
      return (payload as { enabled: boolean }).enabled;
    }
    if (command === "overlay_protection_status") return true;
    return null;
  },
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null;
  },
  Resource: class {
    rid: number;
    constructor(rid: number) {
      this.rid = rid;
    }
    async close() {}
  },
  transformCallback: (callback: unknown) => callback,
}));

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async () => () => {},
  }),
}));

const { ShellView } = await import("../../src/app/AppView");
const { useAgent } = await import("../../src/features/agent");
const { useNotchShell } = await import("../../src/features/shell/hooks/useNotchShell");

type Snapshot = {
  runId: number;
  seq: number;
  status: string;
  provider: string;
  threadId: string | null;
  model: string | null;
  thinkingEffort: string | null;
  usage: null;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string }>;
  activity: Array<{ id: string; kind: string; done: boolean }>;
  capture: { requestId: number; phase: string; error: null };
  error: null;
};

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    runId: 0,
    seq: 0,
    status: "idle",
    provider: "codex",
    threadId: null,
    model: null,
    thinkingEffort: null,
    usage: null,
    messages: [],
    activity: [],
    capture: { requestId: 0, phase: "idle", error: null },
    error: null,
    ...overrides,
  };
}

const running: Snapshot = snapshot({
  runId: 11,
  seq: 2,
  status: "streaming",
  threadId: "thread-1",
  messages: [
    { id: "11:user", role: "user", text: "Deterministic streaming test" },
    { id: "11:assistant", role: "assistant", text: "OTTO_FIRST_CHUNK" },
  ],
});

const update = {
  state: { status: "idle" },
  checkForUpdate: async () => {},
  installUpdate: async () => {},
} as Parameters<typeof ShellView>[0]["appUpdate"];

function Harness() {
  const shell = useNotchShell();
  const agent = useAgent(shell.expanded && shell.isAgent);
  return (
    <ShellView
      agent={agent}
      shell={shell}
      surfaceError={null}
      gutter={0}
      onContentMeasured={() => {}}
      appUpdate={update}
    />
  );
}

function buttonMatching(pattern: RegExp): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find(
    (element) => pattern.test(element.textContent ?? "") || pattern.test(element.getAttribute("aria-label") ?? ""),
  );
  if (!match) throw new Error("No button matched " + pattern);
  return match as HTMLButtonElement;
}

async function push(next: Snapshot) {
  const channel = channels.at(-1);
  if (!channel?.onmessage) throw new Error("Agent channel is not subscribed");
  await act(async () => {
    channel.onmessage?.(next);
  });
}

async function openAgent() {
  localStorage.setItem(
    "otto.preferences.v1",
    JSON.stringify({ hoverExpand: false, motion: "reduced" }),
  );
  render(<Harness />);
  await act(async () => {});
  fireEvent.click(buttonMatching(/Open Agent/));
  await waitFor(() => expect(document.querySelector('[data-surface="agent"]')).not.toBeNull());
}

async function ask(prompt = "Deterministic streaming test") {
  const input = document.querySelector<HTMLTextAreaElement>("#otto-prompt");
  if (!input) throw new Error("Composer did not render");
  fireEvent.change(input, { target: { value: prompt } });
  await waitFor(() => expect(buttonMatching(/Send prompt/).disabled).toBe(false), {
    timeout: 3000,
  });
  fireEvent.click(buttonMatching(/Send prompt/));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  channels.length = 0;
  askPayloads.length = 0;
  guidancePayloads.length = 0;
  deferredAsk = null;
  resolveDeferredAsk = null;
});

describe("Agent run wiring", () => {
  test("pending submission locks navigation until the backend accepts the run", async () => {
    deferredAsk = new Promise((resolve) => {
      resolveDeferredAsk = resolve;
    });
    await openAgent();
    await ask("Pending acceptance test");

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Conversation history" }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect(buttonMatching(/Stop request/)).toBeTruthy();

    await act(async () => {
      resolveDeferredAsk?.({ runId: 11 });
    });
    await push(snapshot({ runId: 11, seq: 1, status: "starting" }));
    expect((screen.getByRole("button", { name: "Conversation history" }) as HTMLButtonElement).disabled).toBe(true);
    await push(snapshot({ runId: 11, seq: 2, status: "stopped" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Conversation history" }) as HTMLButtonElement).disabled).toBe(false),
    );
  }, 15_000);

  test("an accepted prompt clears the composer and renders streaming deltas", async () => {
    await openAgent();
    await ask();
    await push(running);

    await waitFor(() =>
      expect(screen.getByRole("log").textContent).toContain("OTTO_FIRST_CHUNK"),
    );
    expect(screen.getByRole("log").textContent).toContain("Deterministic streaming test");
    await waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#otto-prompt")?.value).toBe(""),
    );
  }, 15_000);

  test("collapsing and reopening keeps the streaming transcript", async () => {
    await openAgent();
    await ask();
    await push(running);
    await waitFor(() =>
      expect(screen.getByRole("log").textContent).toContain("OTTO_FIRST_CHUNK"),
    );

    fireEvent.keyDown(document.querySelector("main"), { key: "Escape" });
    await waitFor(() => expect(document.querySelector('[data-surface="agent"]')).toBeNull());
    fireEvent.click(buttonMatching(/Open Agent/));

    await waitFor(() =>
      expect(screen.getByRole("log").textContent).toContain("OTTO_FIRST_CHUNK"),
    );
    expect(screen.getByRole("log").textContent).not.toContain("OTTO_FINAL_CHUNK");
  }, 15_000);

  test("Stop returns the composer to Send and the terminal answer renders once", async () => {
    await openAgent();
    await ask();
    await push(running);
    await waitFor(() => expect(buttonMatching(/Stop request/)).toBeTruthy());

    fireEvent.click(buttonMatching(/Stop request/));
    await push(
      snapshot({
        runId: 11,
        seq: 3,
        status: "stopped",
        threadId: "thread-1",
        messages: [
          { id: "11:user", role: "user", text: "Deterministic streaming test" },
          { id: "11:assistant", role: "assistant", text: "OTTO_FIRST_CHUNK" },
        ],
      }),
    );

    await waitFor(() => expect(buttonMatching(/Send prompt/)).toBeTruthy());
    const transcript = screen.getByRole("log").textContent ?? "";
    expect(transcript).toContain("OTTO_FIRST_CHUNK");
    expect(transcript.match(/Deterministic streaming test/g)?.length).toBe(1);
  }, 15_000);

  test("completing first-run onboarding syncs profile guidance and sends it on agent_ask", async () => {
    await openAgent();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Let Otto get to know you" })).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText("What should Otto call you?"), {
      target: { value: "Lili" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Developer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Backend & systems" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Bahasa Indonesia" }));
    fireEvent.click(screen.getByRole("button", { name: /Concise & direct/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Let Otto get to know you" })).toBeNull(),
    );
    expect(guidancePayloads.at(-1)).toEqual({
      mode: "direct",
      profile: {
        name: "Lili",
        role: "Developer",
        focus: "Backend & systems",
        language: "Bahasa Indonesia",
        level: "Concise & direct",
        instructions: null,
      },
    });

    await ask("Explain Rust lifetimes");
    await waitFor(() => expect(askPayloads).toHaveLength(1));
    expect(askPayloads[0]?.profile).toEqual({
      name: "Lili",
      role: "Developer",
      focus: "Backend & systems",
      language: "Bahasa Indonesia",
      level: "Concise & direct",
      instructions: null,
    });
  }, 15_000);
});
