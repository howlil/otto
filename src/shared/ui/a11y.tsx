import type { ComponentPropsWithRef, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function VisuallyHidden({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  if (htmlFor) {
    return (
      <label className="sr-only" htmlFor={htmlFor}>
        {children}
      </label>
    );
  }
  return <span className="sr-only">{children}</span>;
}

export function IconButton({
  icon,
  label,
  size,
  variant,
  title,
  className = "",
  ...rest
}: {
  icon: IconName;
  label: string;
  size?: number;
  variant?: "raised" | "quiet" | "round" | "primary" | "outlined";
  title?: string;
} & Omit<ComponentPropsWithRef<"button">, "aria-label" | "title" | "children">) {
  const variantClass = {
    raised:
      "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-otto-panel border-0 bg-otto-raised-soft text-otto-control-text transition-[background,transform] duration-150 hover:bg-otto-line-mid active:scale-[0.96]",
    quiet:
      "grid h-[31px] w-[31px] shrink-0 place-items-center rounded-otto-control border-0 bg-transparent text-otto-text-subtle transition-[background,color,transform] duration-150 hover:bg-otto-raised-soft hover:text-otto-text active:scale-[0.96]",
    round:
      "grid h-8 w-8 shrink-0 place-items-center rounded-full border-0 bg-transparent text-otto-input-hint transition-[background,transform] duration-150 hover:not-disabled:bg-otto-line-strong active:not-disabled:scale-95 disabled:opacity-35",
    primary:
      "grid h-8 w-8 shrink-0 place-items-center rounded-full border-0 bg-otto-icon-active text-otto-ink-deep transition-[background,transform] duration-150 hover:not-disabled:bg-otto-text-bright active:not-disabled:scale-95 disabled:opacity-35",
    outlined:
      "grid h-[29px] w-[29px] place-items-center rounded-otto-control border border-otto-line-mid bg-otto-control text-otto-control-text hover:bg-otto-control-hover",
  }[variant ?? "outlined"];
  return (
    <button type="button" title={title} {...rest} className={`${variantClass} ${className}`.trim()}>
      <Icon name={icon} size={size} />
      <VisuallyHidden>{label}</VisuallyHidden>
    </button>
  );
}
