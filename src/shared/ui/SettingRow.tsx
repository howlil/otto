import type { ReactNode } from "react";
import { Text } from "./Text";

function Heading({ title, help }: { title: string; help?: string }) {
  return (
    <span className="min-w-0">
      <Text as="strong" variant="label" className="block">
        {title}
      </Text>
      {help && (
        <Text as="small" variant="meta" className="mt-0.5 block text-otto-label-muted">
          {help}
        </Text>
      )}
    </span>
  );
}

export function SettingRow({
  title,
  help,
  htmlFor,
  children,
}: {
  title: string;
  help?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const Wrapper = htmlFor ? "label" : "div";
  return (
    <Wrapper
      htmlFor={htmlFor}
      className={`flex min-h-[44px] items-center justify-between gap-3 py-1.5 ${htmlFor ? "cursor-pointer" : ""}`}
    >
      <Heading title={title} help={help} />
      <span className="flex shrink-0 items-center">{children}</span>
    </Wrapper>
  );
}

export function SettingBlock({
  title,
  action,
  htmlFor,
  children,
}: {
  title: string;
  action?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 py-1.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Text
          as={htmlFor ? "label" : "span"}
          variant="label"
          htmlFor={htmlFor}
          className="text-otto-text-secondary"
        >
          {title}
        </Text>
        {action}
      </div>
      {children}
    </section>
  );
}
