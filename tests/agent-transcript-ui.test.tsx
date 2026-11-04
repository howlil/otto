import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageContent } from "../src/features/agent/MessageContent";
import { TranscriptMessages } from "../src/features/agent/TranscriptMessages";
import { AgentTranscript } from "../src/features/agent/AgentTranscript";

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
  toolFreeAdmission: true,
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
