import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { MessageContent } from "../src/features/agent/MessageContent.tsx";
import { highlightCode } from "../src/features/agent/markdown-highlight.ts";

const render = (text) => renderToStaticMarkup(h(MessageContent, { text }));

describe("MessageContent markdown surface", () => {
  test("plain text stays a single paragraph", () => {
    expect(render("hello world")).toBe(
      '<div class="md-body"><p>hello world</p></div>',
    );
  });

  test("headings, lists, links, quotes, tables and task lists render", () => {
    const out = render(
      [
        "## Release notes",
        "",
        "- faster startup",
        "- new model picker",
        "",
        "1. ship",
        "2. verify",
        "",
        "See [docs](https://otto.example/help).",
        "",
        "> quoted remainder",
        "",
        "| key | value |",
        "| --- | --- |",
        "| a | b |",
        "",
        "- [x] done step",
        "- [ ] open step",
      ].join("\n"),
    );
    expect(out).toContain('<h2 class="md-h">Release notes</h2>');
    expect(out).toContain("<ul");
    expect(out).toContain("<li>faster startup</li>");
    expect(out).toContain("<ol");
    expect(out).toContain('<a href="https://otto.example/help"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noreferrer noopener"');
    expect(out).toContain("<blockquote>");
    expect(out).toContain("quoted remainder");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("<td>a</td>");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('checked=""');
    expect(out).toContain("task-list-item");
    expect(out).toContain("done step");
    expect(out).toContain("open step");
  });

  test("single line breaks in plain prose stay visible", () => {
    const out = render("line one\nline two");
    expect(out).toContain("line one<br/>");
    expect(out).toContain("line two");
  });

  test("inline code is styled and not treated as a block", () => {
    const out = render("run `cargo check` next");
    expect(out).toContain('<code class="md-inline-code">cargo check</code>');
    expect(out).not.toContain("<figure");
  });

  test("code block renders detected language label and highlighting", () => {
    const out = render('```ts\nconst n: number = 1;\n```');
    expect(out).toContain("ts");
    expect(out).toContain("hljs-keyword");
    expect(out).toContain("const");
    expect(out).toContain("<figure");
  });

  test("code block keeps a copy button using the source text", () => {
    const out = render('```json\n{"a":1}\n```');
    expect(out).toContain('type="button"');
    expect(out).toContain("Copy code");
  });

  test("unknown language label is shown and code is escaped, not highlighted", () => {
    const out = render("```notalang\n<b>\n```");
    expect(out).toContain("notalang");
    expect(out).toContain("&lt;b&gt;");
  });

  test("code containing HTML and script is escaped, never executed", () => {
    const out = render('```html\n<script>alert(1)</script><img src=x onerror=alert(2)>\n```');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain('onclick');
    expect(out).toContain("hljs-name");
  });

  test("inline math and block math render as KaTeX", () => {
    const out = render(
      "Euler: $e^{i\\pi}+1=0$.\n\n$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$",
    );
    expect(out).toContain('class="katex"');
    expect(out).toContain("katex-display");
    expect(out).toContain("Euler:");
  });

  test("invalid math degrades to a katex-error span instead of throwing", () => {
    const out = render("broken: $\\frac{of$ math");
    expect(out).toContain("broken:");
    expect(out).toContain("katex-error");
    expect(out).toContain("\\frac{of");
    expect(out).toContain('style="color:var(--color-otto-danger-copy)"');
  });

  test("dangerous link and image schemes are stripped", () => {
    const out = render(
      "[a](javascript:alert(1)) ![b](javascript:x) [c](data:text/html,evil)",
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:text/html");
    expect(out).not.toContain("alert(1)\"\"");
    expect(out).toContain('href=""');
  });

  test("empty and blank content renders an empty body", () => {
    expect(render("")).toBe('<div class="md-body"></div>');
    expect(render("   \n\n")).toBe('<div class="md-body"></div>');
  });

  test("empty fenced block renders a code block without crashing", () => {
    const out = render("```\n```");
    expect(out).toContain("<figure");
    expect(out).not.toContain("undefined");
  });

  test("unterminated backtick renders literal text safely", () => {
    const out = render("unfinished ```rust\nlet x = 1;");
    expect(out).toContain("unfinished");
    expect(out).toContain("let x = 1;");
    expect(out).not.toContain("undefined");
  });

  test("partial streaming keeps finished blocks and renders a trailing partial block", () => {
    const out = render("# Done part\n\n```json\n{\"ok\":true}\n```\n```rust\nlet n = ");
    expect(out).toContain('<h1 class="md-h">Done part</h1>');
    expect(out).toContain("hljs-attr");
    expect(out).toContain('data-hljs-language="rust"');
    expect(out).toContain("Copy code");
    expect(out).not.toContain("undefined");
  });
});

describe("markdown-highlight language handling", () => {
  test("known language highlights and reports it", () => {
    const result = highlightCode("let x: u32 = 1;", "rust");
    expect(result.language).toBe("rust");
    expect(result.html).toContain("hljs-keyword");
  });

  test("empty code yields no markup and no undefined", () => {
    const result = highlightCode("", "json");
    expect(result.html).toBe("");
    expect(result.language).toBe("json");
  });

  test("an unlabelled fence is escaped, not auto-detected, during streaming", () => {
    const result = highlightCode("<b>unclosed", undefined);
    expect(result.language).toBe("code");
    expect(result.html).toBe("&lt;b&gt;unclosed");
  });
});

describe("markdown image egress", () => {
  test("remote and data-URI images never become fetchable elements", () => {
    const remote = render("![diagram](https://tracker.example/pixel.png)");
    expect(remote).not.toContain("<img");
    expect(remote).not.toContain("src=");
    expect(remote).not.toContain("preload");
    expect(remote).toContain(">diagram<");
    expect(remote).toContain('href="https://tracker.example/pixel.png"');
    const dataUri = render("![](data:image/png;base64,AAAA)");
    expect(dataUri).not.toContain("<img");
    expect(dataUri).not.toContain("src=");
    expect(dataUri).toContain(">Linked image<");
  });
});
