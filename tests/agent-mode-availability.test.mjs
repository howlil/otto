import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModeSettings } from "../src/features/agent/AgentSettingsSections.tsx";

function modeRows(agentSessionAvailable, locked = false) {
  const html = renderToStaticMarkup(
    createElement(ModeSettings, {
      mode: "quickAsk",
      locked,
      agentSessionAvailable,
      setMode: () => {},
    }),
  );
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
}

describe("Agent mode availability", () => {
  test("unsupported Agent Session does not disable supported Quick Ask", () => {
    const rows = modeRows(false);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Quick Ask");
    expect(rows[0]).not.toMatch(/\bdisabled(?:=|\s|>)/);
    expect(rows[1]).toContain("Agent Session");
    expect(rows[1]).toMatch(/\bdisabled(?:=|\s|>)/);
  });

  test("Codex Agent Session is selectable when capability is present", () => {
    const rows = modeRows(true);
    expect(rows).toHaveLength(2);
    expect(rows[1]).not.toMatch(/\bdisabled(?:=|\s|>)/);
  });

  test("session lock disables both modes independently of capability", () => {
    const rows = modeRows(true, true);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /\bdisabled(?:=|\s|>)/.test(row))).toBe(true);
  });
});
