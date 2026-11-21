import { Text } from "../../../../shared/ui";
import type { Placement } from "../../model/preferences";

export function PlacementChoice({
  selected,
  disabled,
  title,
  label,
  hint,
  value,
  attached,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title?: string;
  label: string;
  hint: string;
  value: Placement;
  attached?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      data-active-key={value}
      className={`relative z-[1] flex flex-col items-center gap-[7px] rounded-otto-card border px-[7px] py-[10px] text-otto-text-paper transition-[background,border-color] duration-[var(--otto-selection-duration)] ease-otto disabled:opacity-[0.43] ${selected ? "border-transparent bg-transparent" : "border-otto-line-strong bg-otto-field-deep"}`}
      onClick={onSelect}
    >
      <span className="relative block h-[42px] w-[77px] rounded-[5px] border border-otto-slider-border bg-otto-ink-deep">
        <i
          className={
            attached
              ? "absolute left-[17px] top-0 h-[13px] w-[41px] rounded-[0_0_12px_12px] bg-otto-slider-thumb"
              : "absolute left-5 top-2 h-[10px] w-[35px] rounded-[20px] bg-otto-slider-thumb"
          }
        />
      </span>
      <span className="flex flex-col items-center gap-0.5">
        <Text as="span" variant="label" className="leading-[1.2]">
          {label}
        </Text>
        <Text as="span" variant="caption" className="text-otto-label-muted">
          {hint}
        </Text>
      </span>
    </button>
  );
}
