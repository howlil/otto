import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

export type TextVariant =
  | "display"
  | "heading"
  | "title"
  | "body"
  | "body-compact"
  | "label"
  | "meta"
  | "caption"
  | "status"
  | "code";

const variants: Record<TextVariant, string> = {
  display: "text-otto-lg font-[520] leading-[1.2]",
  heading: "text-otto-xl font-[550] leading-[1.2]",
  title: "text-otto-md font-[590] leading-[1.2]",
  body: "text-otto-md leading-[1.6]",
  "body-compact": "text-otto-sm leading-[1.5]",
  label: "text-otto-sm font-medium leading-[1.35]",
  meta: "text-otto-xs leading-[1.4]",
  caption: "text-otto-2xs leading-[1.2]",
  status: "text-otto-xs leading-[1.4]",
  code: "font-mono text-otto-xs leading-[1.5]",
};

type TextProps = {
  as?: ElementType;
  variant?: TextVariant;
  className?: string;
  htmlFor?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<"span">, "as" | "children" | "className">;

export function Text({
  as: Component = "span",
  variant = "body",
  className = "",
  children,
  ...props
}: TextProps) {
  return (
    <Component {...props} className={`${variants[variant]} ${className}`.trim()}>
      {children}
    </Component>
  );
}
