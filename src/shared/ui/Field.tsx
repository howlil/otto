import { ActiveIndicatorGroup } from "./ActiveIndicatorGroup";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

export type Choice<T extends string> = {
  value: T;
  label: string;
  help?: string;
  icon?: IconName;
  disabled?: boolean;
  disabledReason?: string;
};

function choiceDisabledReason(
  choice: Choice<string>,
  disabled?: boolean,
  groupReason?: string,
): string | undefined {
  if (choice.disabled) return choice.disabledReason ?? groupReason;
  return disabled ? groupReason : undefined;
}

type ChoiceGroupProps<T extends string> = {
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledReason?: string;
  wrap?: boolean;
};

function ChoiceRowItem<T extends string>({
  choice,
  selected,
  unavailable,
  title,
  onSelect,
}: {
  choice: Choice<T>;
  selected: boolean;
  unavailable: boolean;
  title?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-otto-control border px-3 py-2 text-left text-otto-hover-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${selected ? "border-otto-line-focused bg-otto-selected" : "border-otto-line-mid bg-otto-field-deep hover:border-otto-line-hover"} ${unavailable ? "opacity-45" : ""}`}
      aria-pressed={selected}
      disabled={unavailable}
      title={title}
      onClick={onSelect}
    >
      {choice.icon ? (
        <Icon
          name={choice.icon}
          size={15}
          className={selected ? "shrink-0 text-otto-text" : "shrink-0 text-otto-text-tertiary"}
        />
      ) : (
        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-otto-disabled-outline">
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-otto-control-text" />}
        </span>
      )}
      <span className="min-w-0">
        <Text as="strong" variant="label" className="block">
          {choice.label}
        </Text>
        {choice.help && (
          <Text
            as="small"
            variant="meta"
            className="mt-0.5 block leading-[1.35] text-otto-text-subtle"
          >
            {choice.help}
          </Text>
        )}
      </span>
    </button>
  );
}

export function ChoiceGroup<T extends string>({
  value,
  choices,
  onChange,
  presentation = "chip",
  disabled,
  disabledReason,
  wrap = false,
}: ChoiceGroupProps<T> & {
  presentation?: "chip" | "row";
}) {
  if (presentation === "row") {
    return (
      <div className="flex flex-col gap-1.5">
        {choices.map((choice) => (
          <ChoiceRowItem
            key={choice.value}
            choice={choice}
            selected={value === choice.value}
            unavailable={Boolean(disabled || choice.disabled)}
            title={choiceDisabledReason(choice, disabled, disabledReason)}
            onSelect={() => onChange(choice.value)}
          />
        ))}
      </div>
    );
  }
  return (
    <ActiveIndicatorGroup
      activeKey={value}
      className={
        wrap
          ? "flex flex-wrap gap-1.5"
          : "flex w-full items-center gap-0.5 rounded-otto-control border border-otto-line-soft bg-otto-ink-deep p-0.5"
      }
      indicatorClassName={
        wrap
          ? "rounded-otto-chip border border-otto-line-focused bg-otto-selected-hover"
          : "rounded-[7px] border border-otto-line-mid bg-otto-selected"
      }
    >
      {choices.map((choice) => {
        const selected = value === choice.value;
        return (
          <button
            type="button"
            key={choice.value}
            data-active-key={choice.value}
            className={[
              "relative z-[1] inline-flex h-7 items-center justify-center gap-1.5 text-otto-xs font-medium transition-colors duration-[var(--otto-selection-duration)] ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected disabled:opacity-45",
              wrap
                ? "rounded-otto-chip border px-2.5"
                : "min-w-0 flex-1 whitespace-nowrap rounded-[7px] border-0 px-1.5",
              selected
                ? wrap
                  ? "border-transparent bg-transparent text-otto-text"
                  : "bg-transparent text-otto-text"
                : wrap
                  ? "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text"
                  : "bg-transparent text-otto-text-tertiary hover:text-otto-text",
            ].join(" ")}
            aria-pressed={selected}
            disabled={disabled || choice.disabled}
            title={choiceDisabledReason(choice, disabled, disabledReason)}
            onClick={() => onChange(choice.value)}
          >
            {choice.icon && <Icon name={choice.icon} size={13} className="shrink-0" />}
            <span>{choice.label}</span>
          </button>
        );
      })}
    </ActiveIndicatorGroup>
  );
}
