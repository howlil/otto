import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

function Heading({ title, help, icon }: { title: string; help?: string; icon?: IconName }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {icon && (
        <span className="flex size-4 shrink-0 items-center justify-center text-otto-text-tertiary">
          <Icon name={icon} size={15} />
        </span>
      )}
      <span className="min-w-0">
        <Text as="strong" variant="label" className="block text-otto-text-bright">
          {title}
        </Text>
        {help && (
          <Text as="small" variant="meta" className="mt-0.5 block text-otto-label-muted">
            {help}
          </Text>
        )}
      </span>
    </span>
  );
}

export function SettingRow({
  title,
  help,
  icon,
  htmlFor,
  titleHint,
  children,
}: {
  title: string;
  help?: string;
  icon?: IconName;
  htmlFor?: string;
  titleHint?: string;
  children: ReactNode;
}) {
  const Wrapper = htmlFor ? "label" : "div";
  return (
    <Wrapper
      htmlFor={htmlFor}
      title={titleHint}
      className={`flex min-h-9 items-center justify-between gap-3 py-1.5 ${htmlFor ? "cursor-pointer" : ""}`}
    >
      <Heading title={title} help={help} icon={icon} />
      <span className="flex shrink-0 items-center">{children}</span>
    </Wrapper>
  );
}

export function SettingGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-0.5 pt-3 first:pt-0">
      {title && (
        <Text as="h3" variant="caption" className="mb-1.5 font-medium text-otto-text-tertiary">
          {title}
        </Text>
      )}
      {children}
    </section>
  );
}

export function SettingBlock({
  title,
  help,
  icon,
  action,
  htmlFor,
  children,
}: {
  title: string;
  help?: string;
  icon?: IconName;
  action?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className={`${help ? "mb-1" : "mb-2"} flex min-h-7 items-center justify-between gap-2`}>
        <span className="flex min-w-0 items-center gap-2">
          {icon && (
            <span className="flex size-4 shrink-0 items-center justify-center text-otto-text-tertiary">
              <Icon name={icon} size={14} />
            </span>
          )}
          <Text
            as={htmlFor ? "label" : "span"}
            variant="label"
            htmlFor={htmlFor}
            className="text-otto-text-secondary"
          >
            {title}
          </Text>
        </span>
        {action}
      </div>
      {help && (
        <Text as="small" variant="meta" className="mb-2 block text-otto-label-muted">
          {help}
        </Text>
      )}
      {children}
    </section>
  );
}
