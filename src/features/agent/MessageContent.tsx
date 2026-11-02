import { isValidElement, memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { CodeBlock } from "./CodeBlock";
import { collectCodeText, FENCE_LANGUAGE } from "./markdown-highlight";

function Pre({ children }: ComponentPropsWithoutRef<"pre">) {
  const code = Array.isArray(children) ? children[0] : children;
  const typed = isValidElement<{ className?: string; children?: unknown }>(code) ? code : undefined;
  return (
    <CodeBlock
      code={typed ? collectCodeText(typed.props.children) : collectCodeText(code)}
      language={typed ? FENCE_LANGUAGE.exec(String(typed.props.className ?? ""))?.[1] : undefined}
    />
  );
}

function InlineCode({ children }: ComponentPropsWithoutRef<"code">) {
  return <code className="md-inline-code">{children}</code>;
}

type AnchorProps = ComponentPropsWithoutRef<"a"> & ExtraProps;

function Anchor({ children, node, ...rest }: AnchorProps) {
  return (
    <a {...rest} target="_blank" rel="noreferrer noopener" className="md-link">
      {children}
    </a>
  );
}

function TaskCheckbox({ checked }: { checked?: boolean }) {
  return <input type="checkbox" checked={checked} readOnly disabled className="md-task" />;
}

type ImageProps = ComponentPropsWithoutRef<"img"> & ExtraProps;

function Image({ src, alt }: ImageProps) {
  const label = alt?.trim() || "Linked image";
  if (typeof src !== "string" || !src) return <span className="md-image">{label}</span>;
  return (
    <span className="md-image">
      <a href={src} target="_blank" rel="noreferrer noopener" className="md-link">
        {label}
      </a>
    </span>
  );
}

function Table({ children }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="md-table-scroll">
      <table className="md-table">{children}</table>
    </div>
  );
}

function MdH1({ children }: ComponentPropsWithoutRef<"h1">) {
  return <h1 className="md-h">{children}</h1>;
}

function MdH2({ children }: ComponentPropsWithoutRef<"h2">) {
  return <h2 className="md-h">{children}</h2>;
}

function MdH3({ children }: ComponentPropsWithoutRef<"h3">) {
  return <h3 className="md-h">{children}</h3>;
}

function MdH4({ children }: ComponentPropsWithoutRef<"h4">) {
  return <h4 className="md-h">{children}</h4>;
}

export const MessageContent = memo(function MessageContent({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              throwOnError: false,
              errorColor: "var(--color-otto-danger-copy)",
            },
          ],
        ]}
        components={{
          pre: Pre,
          code: InlineCode,
          a: Anchor,
          img: Image,
          input: TaskCheckbox,
          table: Table,
          h1: MdH1,
          h2: MdH2,
          h3: MdH3,
          h4: MdH4,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
