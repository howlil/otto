import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSettingsDetails } from "../src/features/agent/AgentSettingsDetails.tsx";

const snapshot = (messages, threadId = null) => ({
  runId: 3,
  seq: 5,
  status: "completed",
  provider: "pi",
  threadId,
  model: null,
  thinkingEffort: null,
  usage: null,
  messages,
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
});

const renderSettings = (state) =>
  renderToStaticMarkup(
    h(AgentSettingsDetails, {
      tab: "setup",
      scrollRef: null,
      readiness: {
        status: "ready",
        message: "Provider ready.",
        recovery: "",
        imageInput: false,
        imageTransport: true,
        model: null,
        models: [],
        thinkingEffort: null,
        thinkingEfforts: [],
      },
      provider: "pi",
      setProvider: () => {},
      snapshot: state,
      model: null,
      setModel: () => {},
      thinkingEffort: null,
      setThinkingEffort: () => {},
      runStatus: "completed",
      onRetry: () => {},
      locked: false,
      busy: false,
      error: null,
      onDone: () => {},
      capture: {},
      focusCaptureShortcut: false,
      onMeasured: () => {},
      reducedMotion: true,
    }),
  );

describe("portable Otto conversation disclosure", () => {
  const messages = [
    { id: "1:user", role: "user", text: "Explain borrowing." },
    { id: "1:assistant", role: "assistant", text: "Borrowing preserves ownership." },
  ];

  test("saved transcript without native thread explains bounded reconstruction", () => {
    const markup = renderSettings(snapshot(messages));
    expect(markup).toContain("Previous messages remain in Otto history");
    expect(markup).toContain("bounded text transcript");
    expect(markup).toContain("native session and hidden context cannot");
  });

  test("an active native session does not claim context was lost", () => {
    const markup = renderSettings(snapshot(messages, "active-provider-thread"));
    expect(markup).not.toContain("bounded text transcript");
  });

  test("an empty new conversation shows no reconstruction notice", () => {
    const markup = renderSettings(snapshot([]));
    expect(markup).not.toContain("bounded text transcript");
  });
});
