import { useId, type ComponentPropsWithRef } from "react";
import { Icon, type IconName } from "./Icon";
import { SettingRow } from "./SettingRow";
import { Text } from "./Text";

export function TextArea(props: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} />;
}

export function Range({
  label,
  icon,
  value,
  min,
  max,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  icon?: IconName;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block py-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <span className="flex size-4 shrink-0 items-center justify-center text-otto-text-tertiary">
              <Icon name={icon} size={15} />
            </span>
          )}
          <Text as="span" variant="label" className="text-otto-text-bright">
            {label}
          </Text>
        </span>
        <Text as="output" variant="meta" className="tabular-nums text-otto-text-tertiary">
          {value}
          {unit}
        </Text>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 block h-4 w-full cursor-pointer accent-otto-input-selected disabled:opacity-45"
      />
    </label>
  );
}

export function Toggle({
  title,
  help,
  icon,
  titleHint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  help?: string;
  icon?: IconName;
  titleHint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <SettingRow title={title} help={help} icon={icon} htmlFor={id} titleHint={titleHint}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <i
        className="relative h-[18px] w-[30px] flex-none rounded-full border border-otto-switch-border bg-otto-switch-track transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-otto-icon-muted after:transition-transform after:duration-200 after:content-[''] peer-checked:bg-otto-switch-enabled peer-checked:after:translate-x-3 peer-checked:after:bg-otto-knob peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-otto-input-selected peer-disabled:opacity-45"
        aria-hidden="true"
      />
    </SettingRow>
  );
}
