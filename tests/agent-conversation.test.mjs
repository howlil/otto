import { describe, expect, test } from "bun:test";
import {
  conversationAsMarkdown, matchingMessages, parseMarkdown,
  promptPresets, quoteForFollowUp, withPromptPreset,
} from "../src/features/agent/conversation.ts";

describe("Agent conversation utilities", () => {
  const messages = [
    { id: "1", role: "user", text: "Explain Rust" },
    { id: "2", role: "assistant", text: "Rust has ownership.\n\n\`\`\`rs\nfn main() {}\n\`\`\`" },
  ];

  test("parser preserves fenced code and does not treat HTML as markup", () => {
    expect(parseMarkdown("## Title\n\n- first\n- second\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n<script>alert(1)</script>"))
      .toEqual([
        { kind: "heading", level: 2, text: "Title" },
        { kind: "list", ordered: false, items: ["first", "second"] },
        { kind: "code", language: "ts", text: "const x = 1;" },
        { kind: "paragraph", text: "<script>alert(1)</script>" },
      ]);
  });

  test("unclosed streaming fence is preserved as code", () => {
    expect(parseMarkdown("\`\`\`rust\nlet x = 1;")).toEqual([
      { kind: "code", language: "rust", text: "let x = 1;" },
    ]);
  });

  test("quote preserves original draft and truncation is visible", () => {
    expect(quoteForFollowUp("first\nsecond", "Follow-up:")).toBe("Follow-up:\n\n> first\n> second");
    expect(quoteForFollowUp("", "existing")).toBe("existing");
    expect(quoteForFollowUp("x".repeat(1500), "")).toContain("(excerpt)");
  });

  test("preset insertion never discards an existing unsent draft", () => {
    expect(withPromptPreset("my draft", "Explain: ")).toBe("my draft\n\nExplain: ");
    expect(withPromptPreset("", "Explain: ")).toBe("Explain: ");
    expect(withPromptPreset("my draft", " ")).toBe("my draft");
  });

  test("search is case-insensitive and returns stable message indices", () => {
    expect(matchingMessages(messages, "RUST")).toEqual([0, 1]);
    expect(matchingMessages(messages, "ownership")).toEqual([1]);
    expect(matchingMessages(messages, " ")).toEqual([]);
  });

  test("export retains active provider, workspace, and full messages", () => {
    const output = conversationAsMarkdown(messages, "pi", "C:/repo");
    expect(output).toContain("Provider: pi");
    expect(output).toContain("Project: C:/repo");
    expect(output).toContain("## User\n\nExplain Rust");
    expect(output).toContain("## Assistant\n\nRust has ownership");
    expect(conversationAsMarkdown([], "codex", "")).toBe("");
  });

  test("presets populate drafts without invoking a provider", () => {
    expect(promptPresets.map((preset) => preset.label)).toEqual(["Explain", "Debug", "Summarize"]);
    expect(promptPresets.every((preset) => preset.prompt.length > 0)).toBe(true);
  });
});
