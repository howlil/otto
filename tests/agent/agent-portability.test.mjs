import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantSettings } from "../../src/features/agent/settings/AssistantSettings";

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
    h(AssistantSettings, {
      agent: {
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
        providers: [],
        setProvider: () => {},
        snapshot: state,
        model: null,
        setModel: () => {},
        thinkingEffort: null,
        setThinkingEffort: () => {},
        refreshProvider: async () => {},
        locked: false,
        busy: false,
        captureBusy: false,
        error: null,
      },
    }),
  );

describe("portable Otto conversation disclosure", () => {
  const messages = [
    { id: "1:user", role: "user", text: "Explain borrowing." },
    { id: "1:assistant", role: "assistant", text: "Borrowing preserves ownership." },
  ];

  test("saved transcript without native thread explains bounded reconstruction", () => {
    const markup = renderSettings(snapshot(messages));
    expect(markup).toContain("History stays in Otto");
    expect(markup).toContain("bounded text transcript");
    expect(markup).toContain("not the original session");
  });

  test("an active native session does not claim context was lost", () => {
    const markup = renderSettings(snapshot(messages, "active-provider-thread"));
    expect(markup).not.toContain("bounded text transcript");
  });

  test("an empty new conversation shows no reconstruction notice", () => {
    const markup = renderSettings(snapshot([]));
    expect(markup).not.toContain("bounded text transcript");
  });

  test("ready settings keep status compact and hide unavailable context", () => {
    const markup = renderSettings(snapshot([]));
    expect(markup).toContain("bg-otto-ok");
    expect(markup).toContain(">Ready</span>");
    expect(markup).not.toContain("Context unavailable");
  });
});
