import { createContext, useContext, type ComponentProps, type Ref } from "react";
import { Eyes } from "./Eyes";
import { VisuallyHidden } from "./a11y";

type LogoPreferences = Pick<ComponentProps<typeof Eyes>, "expression" | "reactive">;
const logoPreferences = createContext<LogoPreferences>({});
export const OttoLogoProvider = logoPreferences.Provider;

export function OttoLogo(props: LogoPreferences) {
  const preferences = { ...useContext(logoPreferences), ...props };
  return (
    <span
      className="grid h-[34px] w-[34px] place-items-center rounded-otto-panel bg-otto-raised-soft text-otto-control-text transition-[background,transform] duration-[190ms] ease-otto group-hover:bg-otto-line-mid group-active:scale-[0.96]"
      data-otto-logo="true"
    >
      <Eyes {...preferences} compact />
    </span>
  );
}

export function OttoHomeButton({
  ref,
  label = "Back to Home",
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className="group grid h-[34px] w-[34px] shrink-0 place-items-center border-0 bg-transparent p-0 text-inherit"
      onClick={onClick}
    >
      <OttoLogo />
      <VisuallyHidden>{label}</VisuallyHidden>
    </button>
  );
}
