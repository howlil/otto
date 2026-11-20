import { ChoiceGroup, SelectField, Text } from "../../../shared/ui";
import { effortHint, formatEffortLabel } from "./model-usage";

export function ThinkingEffortField({
  efforts,
  value,
  busy,
  onChange,
}: {
  efforts: string[];
  value: string;
  busy: boolean;
  onChange: (value: string | null) => void;
}) {
  if (efforts.length === 0) return null;
  if (efforts.length <= 6) {
    return (
      <fieldset className="min-w-0 border-0 p-0" aria-labelledby="otto-agent-thinking-label">
        <Text
          as="span"
          variant="label"
          id="otto-agent-thinking-label"
          className="mb-1.5 block text-otto-text-secondary"
        >
          Thinking effort
        </Text>
        <ChoiceGroup
          value={value}
          choices={efforts.map((effort) => ({
            value: effort,
            label: formatEffortLabel(effort),
          }))}
          disabled={busy}
          disabledReason="Finish the current request first"
          onChange={(next) => {
            if (next !== value) onChange(next);
          }}
        />
        <Text as="p" variant="caption" className="mt-1.5 text-otto-text-tertiary">
          {effortHint(value)}
        </Text>
      </fieldset>
    );
  }
  return (
    <div className="min-w-0">
      <Text
        as="label"
        variant="label"
        className="mb-1.5 block text-otto-text-secondary"
        htmlFor="otto-agent-thinking"
      >
        Thinking effort
      </Text>
      <SelectField
        id="otto-agent-thinking"
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value || null)}
      >
        {efforts.map((effort) => (
          <option key={effort} value={effort}>
            {formatEffortLabel(effort)}
          </option>
        ))}
      </SelectField>
      <Text as="p" variant="caption" className="mt-1.5 text-otto-text-tertiary">
        {effortHint(value)}
      </Text>
    </div>
  );
}
