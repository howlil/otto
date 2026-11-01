import { Fragment } from "react";
import { CopyAnswerButton } from "./CopyAnswerButton";
import { parseMarkdown } from "./conversation";

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code className="rounded bg-otto-control px-1 font-mono text-otto-text-soft-white" key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

export function MessageContent({ text }: { text: string }) {
  return (
    <div className="min-w-0 space-y-2 text-otto-md leading-[1.5]">
      {parseMarkdown(text).map((block, index) => {
        if (block.kind === "code") {
          return (
            <div key={index} className="overflow-hidden rounded-otto-control border border-otto-line-mid bg-otto-control-deep">
              <div className="flex items-center justify-between gap-2 border-b border-otto-line-mid px-3 py-1">
                <span className="font-mono text-otto-xs text-otto-text-tertiary">{block.language || "code"}</span>
                <CopyAnswerButton value={block.text} label="Copy code" />
              </div>
              <pre className="max-w-full overflow-x-auto p-3 text-otto-xs leading-[1.6] text-otto-text-soft-white"><code>{block.text}</code></pre>
            </div>
          );
        }
        if (block.kind === "heading") return <p key={index} className="font-semibold text-otto-text-soft-white"><InlineMarkdown text={block.text} /></p>;
        if (block.kind === "quote") return <blockquote key={index} className="border-l-2 border-otto-line-hover pl-3 text-otto-text-secondary"><InlineMarkdown text={block.text} /></blockquote>;
        if (block.kind === "list") {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown text={item} /></li>);
          return block.ordered
            ? <ol key={index} className="list-decimal space-y-1 pl-5">{items}</ol>
            : <ul key={index} className="list-disc space-y-1 pl-5">{items}</ul>;
        }
        return <p key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]"><InlineMarkdown text={block.text} /></p>;
      })}
    </div>
  );
}
