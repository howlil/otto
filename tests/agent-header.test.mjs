import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentHeader } from "../src/features/agent/AgentHeader.tsx";

const props = (overrides = {}) => ({
  view: "chat",
  provider: "codex",
  model: "gpt-5-codex",
  thinkingEffort: "high",
  status: "idle",
  hasThread: false,
  resetBusy: false,
  capturePhase: "idle",
  readiness: "ready",
  onBack: () => {},
  onSettings: () => {},
  onHistory: () => {},
  onNewSession: () => {},
  onHome: () => {},
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

  test("tools-disabled is claimed only after readiness proves chat-only admission", () => {
    expect(render()).toContain("Tools disabled");
    expect(render({ readiness: "checking" })).toContain("Verifying");
    expect(render({ readiness: "checking" })).not.toContain("Tools disabled");
    for (const readiness of ["authRequired", "missing", "unsupported", "unavailable"]) {
      const markup = render({ readiness });
      expect(markup).toContain("Unavailable");
      expect(markup).not.toContain("Tools disabled");
    }
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

  test("nested views replace the chat controls with a back control", () => {
    const chat = render();
    expect(chat).toContain("lucide-settings");
    expect(chat).toContain("lucide-history");
    expect(chat).toContain("h-[53px]");
    for (const view of ["settings", "history"]) {
      const markup = render({ view });
      expect(markup).toContain("Back to");
      expect(markup).not.toContain("lucide-settings");
      expect(markup).not.toContain("lucide-history");
      expect(markup).not.toContain("lucide-plus");
      expect(markup).toContain("h-[51px]");
    }
    expect(render({ view: "history" })).toContain(">History<");
    expect(render({ view: "settings" })).toContain(">Agent settings<");
  });
});
