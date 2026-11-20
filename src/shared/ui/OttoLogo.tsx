import { Eyes } from "./Eyes";

export function OttoLogo({ compact = false }: { compact?: boolean } = {}) {
  return (
    <span
      className={`${compact ? "h-7 w-7 rounded-otto-island" : "h-[34px] w-[34px] rounded-otto-panel"} grid place-items-center bg-otto-raised-soft text-otto-control-text transition-[background] duration-[160ms] ease-otto group-hover:bg-otto-line-mid`}
      data-otto-logo="true"
    >
      <Eyes mini={compact} compact />
    </span>
  );
}
