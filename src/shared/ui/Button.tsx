import { forwardRef, type ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet";
type ButtonSize = "link" | "xs" | "sm";

const variants: Record<ButtonVariant, string> = {
  primary: "border-0 bg-otto-invert-bg text-otto-ink-deep hover:bg-otto-text-bright",
  secondary:
    "border border-otto-line-mid bg-otto-control text-otto-text-secondary hover:bg-otto-control-hover",
  quiet: "border-0 bg-transparent text-otto-muted-strong hover:text-otto-text",
};

const sizes: Record<ButtonSize, string> = {
  link: "rounded-otto-chip px-0 py-1 text-otto-xs",
  xs: "min-h-7 rounded-otto-chip px-3 py-1.5 text-otto-xs",
  sm: "min-h-7 rounded-otto-control px-3.5 py-2 text-otto-sm",
};

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} & ComponentPropsWithoutRef<"button">;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "xs", className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center font-medium transition-colors duration-150 ${sizes[size]} ${variants[variant]} ${className}`.trim()}
    />
  );
});
