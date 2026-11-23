import { Icon, Text, type IconName } from "../../../../shared/ui";
import type { Placement } from "../../model/preferences";

export function PlacementChoice({
  selected,
  disabled,
  title,
  label,
  icon,
  value,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title?: string;
  label: string;
  icon: IconName;
  value: Placement;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      data-active-key={value}
      className={`relative z-[1] flex h-11 min-w-0 items-center gap-2.5 rounded-otto-card border px-2.5 text-left transition-[background,border-color] duration-[var(--otto-selection-duration)] ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected disabled:opacity-45 ${
        selected
          ? "border-transparent bg-transparent text-otto-text"
          : "border-otto-line bg-otto-control text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text"
      }`}
      onClick={onSelect}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-otto-control ${
          selected
            ? "bg-otto-raised-deep text-otto-text"
            : "bg-otto-ink-deep text-otto-text-tertiary"
        }`}
      >
        <Icon name={icon} size={15} />
      </span>
      <Text as="span" variant="label" className="min-w-0 flex-1 truncate">
        {label}
      </Text>
      {selected && (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
          <Icon name="check" size={10} />
        </span>
      )}
    </button>
  );
}
