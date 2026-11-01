import { Fragment } from "react";
import { CopyAnswerButton } from "./CopyAnswerButton";
import { parseMarkdown } from "./conversation";

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  let offset = 0;
  const tokens = parts.filter(Boolean).map((part) => {
    const key = offset;
    offset += part.length;
    return { key, part };
  });
  return (
    <>
      {tokens.map(({ part, key }) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              className="rounded bg-otto-control px-1 font-mono text-otto-text-soft-white"
              key={key}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*"))
          return <em key={key}>{part.slice(1, -1)}</em>;
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

export function MessageContent({ text }: { text: string }) {
  let offset = 0;
  const blocks = parseMarkdown(text).map((block) => {
    const key = offset;
    offset += JSON.stringify(block).length + 1;
    return { block, key };
  });
  return (
    <div className="min-w-0 space-y-2 text-otto-md leading-[1.5]">
      {blocks.map(({ block, key }) => {
        if (block.kind === "code") {
          return (
            <div
              key={key}
              className="overflow-hidden rounded-otto-control border border-otto-line-mid bg-otto-control-deep"
            >
              <div className="flex items-center justify-between gap-2 border-b border-otto-line-mid px-3 py-1">
                <span className="font-mono text-otto-xs text-otto-text-tertiary">
                  {block.language || "code"}
                </span>
                <CopyAnswerButton value={block.text} label="Copy code" />
              </div>
              <pre className="max-w-full overflow-x-auto p-3 text-otto-xs leading-[1.6] text-otto-text-soft-white">
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }
        if (block.kind === "heading")
          return (
            <p key={key} className="font-semibold text-otto-text-soft-white">
              <InlineMarkdown text={block.text} />
            </p>
          );
        if (block.kind === "quote")
          return (
            <blockquote
              key={key}
              className="border-l-2 border-otto-line-hover pl-3 text-otto-text-secondary"
            >
              <InlineMarkdown text={block.text} />
            </blockquote>
          );
        if (block.kind === "list") {
          let itemOffset = 0;
          const items = block.items.map((item) => {
            const itemKey = itemOffset;
            itemOffset += item.length + 1;
            return (
              <li key={itemKey}>
                <InlineMarkdown text={item} />
              </li>
            );
          });
          return block.ordered ? (
            <ol key={key} className="list-decimal space-y-1 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {items}
            </ul>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            <InlineMarkdown text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
