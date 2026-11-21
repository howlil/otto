import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageContent } from "../../src/features/agent/transcript/content/MessageContent";
import { TranscriptMessages } from "../../src/features/agent/transcript/TranscriptMessages";
import { AgentTranscript } from "../../src/features/agent/transcript/AgentTranscript";
import { prepareAnswerForInsertion } from "../../src/features/agent/transcript/content/InsertAnswerButton";

const fenced = "Use this:\n\n```ts\nconst total = items.reduce(sum);\n```\n\nDone.";

const snapshot = (overrides = {}) => ({
  runId: 1,
  seq: 1,
  status: "completed",
  provider: "codex",
  threadId: "thread",
  model: "gpt-5-codex",
  thinkingEffort: "high",
  usage: null,
  messages: [{ id: "1:assistant", role: "assistant", text: fenced }],
  activity: [],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
  ...overrides,
});

const readiness = {
  status: "ready",
  message: "",
  recovery: "",
  imageInput: false,
  imageTransport: false,
  model: "gpt-5-codex",
  models: [],
  thinkingEffort: "high",
  thinkingEfforts: ["high"],
};

const transcript = (seq: number) => ({
  snapshot: snapshot({ seq, status: "streaming" }),
  readiness,
  draft: "",
  setDraft: () => {},
  error: null,
  busy: true,
  captureBusy: false,
  send: async () => {},
  stop: async () => {},
  refreshProvider: async () => {},
  retryConnection: async () => {},
  clearError: () => {},
  errorKind: null,
});

const view = (seq: number) => (
  <AgentTranscript
    agent={transcript(seq)}
    onConfigureCapture={() => {}}
    onCapture={() => {}}
    captureActionError={null}
    onMeasured={() => {}}
  />
);

let clipboard: string[] = [];

const stubClipboard = () => {
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        clipboard.push(text);
      },
    },
  });
};

const setMetrics = (
  element: Element,
  values: { scrollHeight: number; clientHeight: number; scrollTop: number },
) => {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: values.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: values.clientHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: values.scrollTop,
  });
};

afterEach(cleanup);

describe("Agent transcript copy actions", () => {
  test("copying a code block sends the exact fenced source", async () => {
    stubClipboard();
    render(<MessageContent text={fenced} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    });
    expect(clipboard).toHaveLength(1);
    expect(clipboard[0].trimEnd()).toBe("const total = items.reduce(sum);");
  });

  test("copying an answer sends the whole message text, not highlighted markup", async () => {
    stubClipboard();
    render(<TranscriptMessages snapshot={snapshot()} busy={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(clipboard).toEqual([fenced]);
    expect(screen.getByText("Answer copied")).toBeTruthy();
  });

  test("copy feedback is not offered while the answer is still streaming", () => {
    stubClipboard();
    render(<TranscriptMessages snapshot={snapshot({ status: "streaming" })} busy />);
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });

  test("inserting sends the whole completed answer to the requested external caret", async () => {
    const inserted: string[] = [];
    render(
      <TranscriptMessages
        snapshot={snapshot()}
        busy={false}
        onInsert={async (value) => {
          inserted.push(value);
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    expect(inserted).toEqual(["Use this:\n\nconst total = items.reduce(sum);\n\nDone."]);
    expect(screen.getByText("Sent")).toBeTruthy();
  });

  test("removing code fences preserves every code line and indentation", () => {
    const answer = "Before\n\n```ts\nfunction run() {\n  return 1;\n}\n```\n\nAfter";
    expect(prepareAnswerForInsertion(answer)).toBe(
      "Before\n\nfunction run() {\n  return 1;\n}\n\nAfter",
    );
  });

  test("insert failure explains how to recover", async () => {
    render(
      <TranscriptMessages
        snapshot={snapshot()}
        busy={false}
        onInsert={async () => {
          throw new Error("Focus an editable field and retry.");
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Focus an editable field");
  });
});

describe("Agent transcript streaming viewport", () => {
  const follow = () => {
    const calls: Array<{ top?: number }> = [];
    const feed = screen.getByRole("log");
    Object.defineProperty(feed, "scrollTo", {
      configurable: true,
      value: (options: { top?: number }) => {
        calls.push(options);
      },
    });
    return { feed, calls };
  };

  test("new output follows the bottom while the reader stays at the bottom", () => {
    const rendered = render(view(1));
    const { feed, calls } = follow();
    setMetrics(feed, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    calls.length = 0;
    rendered.rerender(view(2));
    expect(calls).toEqual([{ top: 1000 }]);
  });

  test("late formatting follows the bottom without a new snapshot but preserves a scrolled-up reader", () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    const notifications: Array<() => void> = [];
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        notifications.push(() => callback([], this as unknown as ResizeObserver));
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      render(view(1));
      const feed = screen.getByRole("log");
      setMetrics(feed, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
      Object.defineProperty(feed, "scrollTo", {
        configurable: true,
        value: ({ top }: { top: number }) => {
          feed.scrollTop = Math.min(top, feed.scrollHeight - feed.clientHeight);
        },
      });
      setMetrics(feed, { scrollHeight: 1500, clientHeight: 400, scrollTop: 600 });
      act(() => notifications.forEach((notify) => notify()));
      expect(feed.scrollTop).toBe(1100);
      feed.scrollTop = 100;
      fireEvent.scroll(feed);
      setMetrics(feed, { scrollHeight: 1800, clientHeight: 400, scrollTop: 100 });
      act(() => notifications.forEach((notify) => notify()));
      expect(feed.scrollTop).toBe(100);
    } finally {
      cleanup();
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  test("new output does not yank a reader who scrolled up", () => {
    const rendered = render(view(1));
    const { feed, calls } = follow();
    setMetrics(feed, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
    fireEvent.scroll(feed);
    calls.length = 0;
    rendered.rerender(view(2));
    expect(calls).toEqual([]);
  });
});

describe("Agent transcript capture feedback", () => {
  test("does not repeat the capture phase below the transcript", () => {
    const agent = {
      ...transcript(1),
      captureBusy: true,
      snapshot: snapshot({
        status: "streaming",
        capture: { requestId: 1, phase: "capturing", error: null },
      }),
    };

    render(
      <AgentTranscript
        agent={agent}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        onMeasured={() => {}}
      />,
    );

    expect(screen.queryByText("Capturing screen…")).toBeNull();
  });
});

describe("Agent activity trail", () => {
  test("shows inline step summaries and expands detail on click while running", () => {
    const agent = {
      ...transcript(1),
      busy: true,
      snapshot: snapshot({
        status: "streaming",
        activity: [
          {
            id: "t1",
            kind: "thinking",
            done: true,
            summary: "Inspect transcript layout",
            detail: "Inspect transcript layout\nCheck scroll container behavior",
          },
          {
            id: "a",
            kind: "search",
            done: true,
            summary: "ActivityTrail",
            detail: "WebSearch\nquery: ActivityTrail",
          },
          {
            id: "b",
            kind: "read",
            done: false,
            summary: "src/App.tsx",
            detail: "Read\nfile_path: src/App.tsx",
          },
        ],
      }),
    };

    render(
      <AgentTranscript
        agent={agent}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        captureSource="window"
        onMeasured={() => {}}
      />,
    );

    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Inspect transcript layout")).toBeTruthy();
    expect(screen.getByText("Searching")).toBeTruthy();
    expect(screen.getByText("ActivityTrail")).toBeTruthy();
    expect(screen.getByText("Reading context")).toBeTruthy();
    expect(screen.getByText("src/App.tsx")).toBeTruthy();
    expect(screen.queryByText("Writing answer")).toBeNull();
    expect(screen.queryByText(/Check scroll container behavior/)).toBeNull();

    const thinkingButton = screen.getByRole("button", { name: /Thinking/ });
    expect(thinkingButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(thinkingButton);
    expect(thinkingButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Check scroll container behavior/)).toBeTruthy();
  });

  test("expands hidden earlier steps when more than four steps occur while active", () => {
    const agent = {
      ...transcript(1),
      busy: true,
      snapshot: snapshot({
        status: "streaming",
        activity: [
          { id: "s1", kind: "read", done: true, summary: "file-1.ts" },
          { id: "s2", kind: "read", done: true, summary: "file-2.ts" },
          { id: "s3", kind: "read", done: true, summary: "file-3.ts" },
          { id: "s4", kind: "read", done: true, summary: "file-4.ts" },
          { id: "s5", kind: "command", done: false, summary: "bun test" },
        ],
      }),
    };

    render(
      <AgentTranscript
        agent={agent}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        captureSource="window"
        onMeasured={() => {}}
      />,
    );

    expect(screen.queryByText("file-1.ts")).toBeNull();
    expect(screen.getByText("bun test")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /Show all 5 steps/ });
    fireEvent.click(toggle);
    expect(screen.getByText("file-1.ts")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Show fewer steps/ })).toBeTruthy();
  });

  test("collapses steps into an inspectable summary when the answer finishes", () => {
    const runningAgent = {
      ...transcript(1),
      busy: true,
      snapshot: snapshot({
        status: "streaming",
        activity: [
          {
            id: "s1",
            kind: "thinking",
            done: true,
            summary: "Plan edit",
            detail: "Plan edit\nUpdate ActivityTrail",
          },
          {
            id: "s2",
            kind: "command",
            done: true,
            summary: "cargo test",
            detail: "Bash\ncommand: cargo test",
          },
        ],
      }),
    };

    const rendered = render(
      <AgentTranscript
        agent={runningAgent}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        captureSource="window"
        onMeasured={() => {}}
      />,
    );

    expect(screen.getByText("Plan edit")).toBeTruthy();

    rendered.rerender(
      <AgentTranscript
        agent={{
          ...runningAgent,
          busy: false,
          snapshot: {
            ...runningAgent.snapshot,
            seq: 2,
            status: "completed",
          },
        }}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        captureSource="window"
        onMeasured={() => {}}
      />,
    );

    expect(screen.queryByText("Plan edit")).toBeNull();
    const summaryButton = screen.getByRole("button", { name: "2 steps" });
    expect(summaryButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(summaryButton);
    expect(summaryButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Plan edit")).toBeTruthy();
    expect(screen.getByText("cargo test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Checking system/ }));
    expect(screen.getByText(/command: cargo test/)).toBeTruthy();
  });

  test("completed run with no provider activity shows no step toggle", () => {
    render(
      <AgentTranscript
        agent={{
          ...transcript(1),
          busy: false,
          snapshot: snapshot({ status: "completed", activity: [] }),
        }}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        captureSource="window"
        onMeasured={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /step/ })).toBeNull();
  });

  test("single completed thinking step opens its detail directly on summary click", () => {
    render(
      <AgentTranscript
        agent={{
          ...transcript(1),
          busy: false,
          snapshot: snapshot({
            status: "completed",
            activity: [
              {
                id: "t1",
                kind: "thinking",
                done: true,
                summary: "Analyze bug",
                detail: "Analyze bug\nFound root cause in turn.rs",
              },
            ],
          }),
        }}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        captureSource="window"
        onMeasured={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 step" }));
    expect(screen.getByText(/Found root cause in turn\.rs/)).toBeTruthy();
  });
});

describe("Slice 3 conversation controls and output ergonomics", () => {
  test("universal Insert, Retry, Edit prompt, and learning follow-up chips operate on completed turns", async () => {
    const inserted: string[] = [];
    const retried: number[] = [];
    const edited: Array<[string, string]> = [];
    const chips: Array<[string, string]> = [];
    let escaped = 0;

    render(
      <div onKeyDown={(event) => event.key === "Escape" && (escaped += 1)}>
        <AgentTranscript
          agent={{
            ...transcript(2),
            busy: false,
            snapshot: snapshot({
              runId: 2,
              status: "completed",
              messages: [
                { id: "1:user", role: "user", text: "First question" },
                { id: "1:assistant", role: "assistant", text: "First answer" },
                { id: "2:user", role: "user", text: "Second question" },
                { id: "2:assistant", role: "assistant", text: "Second answer" },
              ],
            }),
            retryLast: async () => {
              retried.push(1);
            },
            editPrompt: async (id, text) => {
              edited.push([id, text]);
            },
            sendFollowupChip: async (mode, promptText) => {
              chips.push([mode, promptText]);
            },
          }}
          captureSource="window"
          onInsert={async (value) => {
            inserted.push(value);
          }}
          onConfigureCapture={() => {}}
          onCapture={() => {}}
          captureActionError={null}
          onMeasured={() => {}}
        />
      </div>,
    );

    const insertButtons = screen.getAllByRole("button", { name: "Insert" });
    expect(insertButtons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(insertButtons[1]);
    });
    expect(inserted).toEqual(["Second answer"]);

    const retryButtons = screen.getAllByRole("button", { name: "Retry" });
    expect(retryButtons).toHaveLength(1);
    fireEvent.click(retryButtons[0]);
    expect(retried).toEqual([1]);

    expect(screen.getByRole("button", { name: "Simpler" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Give an example" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quiz me" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go deeper" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quiz me" }));
    expect(chips[0]?.[0]).toBe("practice");

    const editButtons = screen.getAllByRole("button", { name: "Edit prompt" });
    expect(editButtons).toHaveLength(2);
    fireEvent.click(editButtons[0]);
    const editBox = screen.getByLabelText("Edit prompt") as HTMLTextAreaElement;
    expect(editBox.value).toBe("First question");
    fireEvent.keyDown(editBox, { key: "Escape" });
    expect(escaped).toBe(0);
    expect(screen.queryByLabelText("Edit prompt")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit prompt" })[0]);
    const nextEditBox = screen.getByLabelText("Edit prompt");
    fireEvent.change(nextEditBox, { target: { value: "Refined first question" } });
    fireEvent.keyDown(nextEditBox, { key: "Enter", shiftKey: false });
    expect(edited).toEqual([["1:user", "Refined first question"]]);
  });

  test("stopped partial answers keep text with Stopped badge and omit Insert and completed chips", () => {
    render(
      <AgentTranscript
        agent={{
          ...transcript(3),
          busy: false,
          snapshot: snapshot({
            runId: 3,
            status: "stopped",
            messages: [
              { id: "3:user", role: "user", text: "Derive proof" },
              { id: "3:assistant", role: "assistant", text: "Partial derivation so far..." },
            ],
          }),
          retryLast: async () => {},
          sendFollowupChip: async () => {},
        }}
        captureSource="window"
        onInsert={async () => {}}
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        onMeasured={() => {}}
      />,
    );

    expect(screen.getByText("Partial derivation so far...")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Insert" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Simpler" })).toBeNull();
  });

  test("latest completed answer renders subtle muted response latency with TTFT tooltip", () => {
    render(
      <TranscriptMessages
        snapshot={snapshot({
          runId: 5,
          status: "completed",
          messages: [
            { id: "4:assistant", role: "assistant", text: "Earlier answer" },
            { id: "5:assistant", role: "assistant", text: "Fast answer" },
          ],
          turnTiming: {
            runId: 5,
            startedAtMs: 1000,
            firstTokenMs: 320,
            totalMs: 1450,
          },
        })}
        busy={false}
      />,
    );
    const badge = screen.getByText("1.5s");
    expect(badge.getAttribute("title")).toBe("First token 320ms · Total 1.5s");
    expect(screen.getAllByText("1.5s")).toHaveLength(1);
  });
});

describe("Slice 4 inline host permission choice card", () => {
  test("renders explicit Decline & continue and Allow once choices without stealing focus", async () => {
    const decisions: Array<[string, boolean]> = [];
    const baseAgent = {
      ...transcript(4),
      busy: true,
      snapshot: snapshot({
        runId: 4,
        status: "streaming",
        pendingPermission: {
          requestId: "perm-42",
          runId: 4,
          engine: "Codex",
          title: "Run shell command",
          summary: "git status",
        },
      }),
      respondPermission: async (requestId: string, allow: boolean) => {
        decisions.push([requestId, allow]);
      },
    };

    const view = render(
      <AgentTranscript
        agent={baseAgent}
        captureSource="window"
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        onMeasured={() => {}}
      />,
    );

    const prompt = screen.getByRole("textbox");
    prompt.focus();
    expect(document.activeElement).toBe(prompt);
    expect(screen.getByText("Codex is asking permission")).toBeTruthy();
    expect(screen.getByText("Run shell command")).toBeTruthy();
    expect(screen.getByText("git status")).toBeTruthy();
    expect(screen.getByText("Otto never approves actions automatically.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Decline & continue" }));
    });
    expect(decisions).toEqual([["perm-42", false]]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    });
    expect(decisions).toEqual([
      ["perm-42", false],
      ["perm-42", true],
    ]);

    view.rerender(
      <AgentTranscript
        agent={{
          ...baseAgent,
          snapshot: snapshot({ runId: 4, status: "streaming", pendingPermission: null }),
        }}
        captureSource="window"
        onConfigureCapture={() => {}}
        onCapture={() => {}}
        captureActionError={null}
        onMeasured={() => {}}
      />,
    );
    expect(screen.queryByText("Codex is asking permission")).toBeNull();
  });
});
