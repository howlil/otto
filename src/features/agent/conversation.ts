import type { AgentSnapshot } from "../../platform/tauri";

type Message = AgentSnapshot["messages"][number];
export type MarkdownBlock =
  | { kind: "code"; language: string; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph" | "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

export const promptPresets = [
  { label: "Explain", prompt: "Explain this concept clearly with an example: " },
  { label: "Debug", prompt: "Help me debug this problem. Expected behavior: " },
  { label: "Summarize", prompt: "Summarize the following information into key points: " },
] as const;

export function quoteForFollowUp(answer: string, draft: string): string {
  const excerpt = answer.trim().slice(0, 1200);
  if (!excerpt) return draft;
  const quoted = excerpt
    .split("\n")
    .map((line) => "> " + line)
    .join("\n");
  const suffix = answer.trim().length > 1200 ? "\n> … (excerpt)" : "";
  return [draft.trim(), quoted + suffix].filter(Boolean).join("\n\n");
}

export function matchingMessages(messages: Message[], term: string): number[] {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return [];
  return messages.flatMap((message, index) =>
    message.text.toLocaleLowerCase().includes(needle) ? [index] : [],
  );
}

export function conversationAsMarkdown(
  messages: Message[],
  provider: string,
  project: string,
): string {
  if (!messages.length) return "";
  const lines = [
    "# Otto conversation",
    "",
    "Provider: " + provider,
    "Project: " + (project || "Default"),
    "",
  ];
  for (const message of messages) {
    lines.push("## " + (message.role === "user" ? "User" : "Assistant"), "", message.text, "");
  }
  return lines.join("\n");
}

export function parseMarkdown(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s{0,3}```([\w+.#-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s{0,3}```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ kind: "code", language: fence[1], text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      blocks.push({ kind: "quote", text: line.replace(/^\s*>\s?/, "") });
      continue;
    }
    const item = /^\s{0,3}([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1]);
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "list" && previous.ordered === ordered) previous.items.push(item[2]);
      else blocks.push({ kind: "list", ordered, items: [item[2]] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
