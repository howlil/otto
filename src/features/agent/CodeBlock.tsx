import { CopyAnswerButton } from "./CopyAnswerButton";
import { highlightCode } from "./markdown-highlight";

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { language: name, html } = highlightCode(code, language);

  return (
    <figure className="m-0 mt-1 overflow-hidden rounded-[9px] border border-otto-line bg-otto-ink-deep">
      <figcaption className="flex items-center justify-between gap-2 border-b border-otto-line bg-otto-control px-[9px] py-[3px]">
        <span className="truncate font-otto-mono text-otto-2xs uppercase tracking-[0.08em] text-otto-text-tertiary">
          {name}
        </span>
        <CopyAnswerButton value={code} label="Copy code" />
      </figcaption>
      <pre className="m-0 overflow-x-auto px-[9px] py-[7px] font-otto-mono text-otto-xs leading-[1.55]">
        <code
          className="hljs"
          data-hljs-language={name}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </figure>
  );
}
