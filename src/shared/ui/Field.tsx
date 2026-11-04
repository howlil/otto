import { ActiveIndicatorGroup } from "./ActiveIndicatorGroup";
import { Text } from "./Text";

export type Choice<T extends string> = {
  value: T;
  label: string;
  help?: string;
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
};

export function ChoiceGroup<T extends string>({
  value,
  choices,
  onChange,
  presentation = "chip",
  disabled,
  disabledReason,
}: ChoiceGroupProps<T> & {
  presentation?: "chip" | "row";
}) {
  if (presentation === "row") {
    return (
      <div className="flex flex-col gap-1.5">
        {choices.map((choice) => {
          const selected = value === choice.value;
          const unavailable = disabled || choice.disabled;
          return (
            <button
              type="button"
              key={choice.value}
              className={`flex min-h-[45px] w-full items-center gap-2.5 rounded-otto-control border px-[11px] py-[9px] text-left text-otto-hover-text ${selected ? "border-otto-line-muted bg-otto-control-deep" : "border-otto-line-mid bg-otto-field-deep"} ${unavailable ? "opacity-50" : ""}`}
              aria-pressed={selected}
              disabled={unavailable}
              title={choiceDisabledReason(choice, disabled, disabledReason)}
              onClick={() => onChange(choice.value)}
            >
              <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-otto-disabled-outline">
                {selected && <span className="h-1.5 w-1.5 rounded-full bg-otto-control-text" />}
              </span>
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
        })}
      </div>
    );
  }
  return (
    <ActiveIndicatorGroup
      activeKey={value}
      className="flex flex-wrap gap-1.5"
      indicatorClassName="rounded-otto-chip border border-otto-line-focused bg-otto-selected-hover"
    >
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          data-active-key={choice.value}
          className={[
            "relative z-[1] min-h-7 rounded-otto-chip border px-2.5 py-[7px] text-otto-xs transition-colors duration-[var(--otto-selection-duration)] ease-otto",
            value === choice.value
              ? "border-transparent bg-transparent text-otto-invert-line"
              : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:bg-otto-control-hover",
          ].join(" ")}
          aria-pressed={value === choice.value}
          disabled={disabled || choice.disabled}
          title={choiceDisabledReason(choice, disabled, disabledReason)}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </ActiveIndicatorGroup>
  );
}

export function SegmentedControl<T extends string>(props: ChoiceGroupProps<T>) {
  return <ChoiceGroup {...props} presentation="chip" />;
}

export function RadioGroup<T extends string>(props: ChoiceGroupProps<T>) {
  return <ChoiceGroup {...props} presentation="row" />;
}
