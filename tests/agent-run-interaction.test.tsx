import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const channels: Array<{ onmessage: ((value: unknown) => void) | null }> = [];
let deferredAsk: Promise<{ runId: number }> | null = null;
let resolveDeferredAsk: ((value: { runId: number }) => void) | null = null;

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, payload: unknown) => {
    if (command === "agent_subscribe") {
      channels.push((payload as { onEvent: { onmessage: ((value: unknown) => void) | null } }).onEvent);
      return channels.length;
    }
    if (command === "agent_codex_installed") return true;
    if (command === "agent_provider_readiness" || command === "agent_codex_readiness") {
      return {
        status: "ready",
        message: "Codex ready",
        recovery: "",
        imageInput: true,
        imageTransport: true,
        toolFreeAdmission: true,
        model: "gpt-5-codex",
        models: [{ id: "gpt-5-codex", label: "gpt-5-codex", imageInput: true, thinkingEfforts: ["medium"] }],
        thinkingEffort: "medium",
        thinkingEfforts: ["medium"],
      };
    }
    if (command === "agent_ask") {
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

const { ShellView } = await import("../src/AppView");
const { useAgent } = await import("../src/features/agent");
const { useNotchShell } = await import("../src/features/shell/useNotchShell");

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
const musicStub = {} as Parameters<typeof ShellView>[0]["music"];
const focusStub = {} as Parameters<typeof ShellView>[0]["focus"];

function Harness() {
  const shell = useNotchShell();
  const agent = useAgent(shell.expanded && shell.isAgent);
  return (
    <ShellView
      agent={agent}
      music={musicStub}
      focus={focusStub}
      shell={shell}
      surfaceError={null}
      agentHomeCopy="Ask your CLI"
      musicHomeCopy="No media session"
      artProps={{ tilt: 43, gradient: 80 }}
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
  fireEvent.click(buttonMatching(/Open Otto/));
  await waitFor(() => expect(agentCard()).toBeTruthy());
  fireEvent.click(agentCard());
  await waitFor(() => expect(document.querySelector('[data-surface="agent"]')).not.toBeNull());
}

function agentCard(): HTMLButtonElement {
  const card = Array.from(document.querySelectorAll("button")).find(
    (element) => element.querySelector("strong")?.textContent?.trim() === "Agent",
  );
  if (!card) throw new Error("Agent launcher card is not rendered");
  return card as HTMLButtonElement;
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
  });

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
  });

  test("navigating Home and back keeps the streaming transcript", async () => {
    await openAgent();
    await ask();
    await push(running);
    await waitFor(() =>
      expect(screen.getByRole("log").textContent).toContain("OTTO_FIRST_CHUNK"),
    );

    fireEvent.click(buttonMatching(/Return to Home/));
    await waitFor(() => expect(document.querySelector('[data-surface="agent"]')).toBeNull());
    fireEvent.click(agentCard());

    await waitFor(() =>
      expect(screen.getByRole("log").textContent).toContain("OTTO_FIRST_CHUNK"),
    );
    expect(screen.getByRole("log").textContent).not.toContain("OTTO_FINAL_CHUNK");
  });

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
  });
});
