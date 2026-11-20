import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentHeader } from "../../src/features/agent/conversation/AgentHeader";

const props = (overrides = {}) => ({
  view: "chat",
  provider: "codex",
  model: "gpt-5-codex",
  thinkingEffort: "high",
  status: "idle",
  hasThread: false,
  resetBusy: false,
  onBack: () => {},
  onSettings: () => {},
  onHistory: () => {},
  onNewSession: () => {},
  gearRef: { current: null },
  ...overrides,
});

const render = (overrides = {}) =>
  renderToStaticMarkup(h(AgentHeader, props(overrides)));

describe("agent header runtime and capability label", () => {
  test("the selected model and thinking effort are visible before submitting", () => {
    const markup = render();
    expect(markup).toContain("Codex");
    expect(markup).toContain("gpt-5-codex · high");
  });

  test("the header names the provider and runtime without claiming a status", () => {
    const markup = render();
    expect(markup).not.toContain("Ready");
    expect(markup).not.toContain("Verifying");
    expect(markup).not.toContain("Unavailable");
  });

  test("an unselected model is named instead of inventing one", () => {
    const markup = render({ model: null, thinkingEffort: null });
    expect(markup).toContain("Model not selected");
    expect(markup).not.toContain("gpt-5-codex");
  });

  test("history access is a labelled control and new chat only appears for a thread", () => {
    expect(render()).toContain("Conversation history");
    expect(render()).not.toContain("New chat");
    expect(render({ hasThread: true })).toContain("New chat");
    expect(render({ resetBusy: true, hasThread: true })).toContain(
      "Finish or stop the current request first",
    );
  });

  test("settings has a single entry and nested views replace the chat controls", () => {
    const chat = render();
    expect(chat).toContain("Settings");
    expect(chat).not.toContain("Open Otto settings");
    expect(chat).toContain("lucide-settings");
    expect(chat).toContain("lucide-history");
    expect(chat).toContain("data-otto-logo");
    expect(chat).toContain("h-[53px]");
    const history = render({ view: "history" });
    expect(history).toContain("Back to");
    expect(history).not.toContain("lucide-settings");
    expect(history).not.toContain("lucide-history");
    expect(history).not.toContain("lucide-plus");
    expect(history).toContain("h-[51px]");
    expect(history).toContain(">History<");
  });
});
