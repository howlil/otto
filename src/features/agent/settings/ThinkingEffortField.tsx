import { ChoiceGroup, Icon, SelectField, Text } from "../../../shared/ui";
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
        <span className="mb-1.5 flex items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center text-otto-text-tertiary">
            <Icon name="brain" size={14} />
          </span>
          <Text
            as="span"
            variant="label"
            id="otto-agent-thinking-label"
            className="text-otto-text-secondary"
          >
            Thinking effort
          </Text>
        </span>
        <ChoiceGroup
          value={value}
          wrap={efforts.length > 4}
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
      <span className="mb-1.5 flex items-center gap-2">
        <span className="flex size-4 shrink-0 items-center justify-center text-otto-text-tertiary">
          <Icon name="brain" size={14} />
        </span>
        <Text
          as="label"
          variant="label"
          className="text-otto-text-secondary"
          htmlFor="otto-agent-thinking"
        >
          Thinking effort
        </Text>
      </span>
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
