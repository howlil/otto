import type { ComponentPropsWithRef, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

// Accessible name without an `aria-label`: the text is rendered and hidden,
// so assistive tech reads the same words a sighted user reads on screen. A
// `htmlFor` turns it into a real <label>, which is how a field gets its name.
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

// An icon-only control. The label is a real string, rendered through
// VisuallyHidden, so no surface has to remember to spell ARIA by hand.
export function IconButton({
  icon,
  label,
  size,
  className = "",
  ...rest
}: {
  icon: IconName;
  label: string;
  size?: number;
} & Omit<ComponentPropsWithRef<"button">, "aria-label" | "title" | "children">) {
  return (
    <button type="button" {...rest} className={className}>
      <Icon name={icon} size={size} />
      <VisuallyHidden>{label}</VisuallyHidden>
    </button>
  );
}
