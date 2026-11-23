import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Icon, type IconName } from "./Icon";

type ButtonVariant = "primary" | "secondary" | "quiet";
type ButtonSize = "link" | "xs" | "sm";

const variants: Record<ButtonVariant, string> = {
  primary: "border-0 bg-otto-invert-bg text-otto-ink-deep hover:bg-otto-text-bright",
  secondary:
    "border border-otto-line-mid bg-otto-control text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text",
  quiet:
    "border-0 bg-transparent text-otto-muted-strong hover:bg-otto-raised-soft hover:text-otto-text",
};

const sizes: Record<ButtonSize, string> = {
  link: "h-7 gap-1.5 rounded-otto-chip px-2 text-otto-xs",
  xs: "h-7 gap-1.5 rounded-otto-chip px-2.5 text-otto-xs",
  sm: "h-8 gap-1.5 rounded-otto-control px-3 text-otto-sm",
};

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconSize?: number;
  className?: string;
} & ComponentPropsWithoutRef<"button">;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "xs", icon, iconSize = 13, className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected disabled:opacity-45 ${sizes[size]} ${variants[variant]} ${className}`.trim()}
    >
      {icon && <Icon name={icon} size={iconSize} className="shrink-0" />}
      {children}
    </button>
  );
});
