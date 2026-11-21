import type { AgentModelOption } from "../../../platform/tauri";
import { SelectField } from "../../../shared/ui";
import { PinModelButton } from "./ModelPickerList";

export function ModelSelectRow({
  id,
  models,
  pinned,
  rest,
  value,
  selectedOption,
  isPinned,
  busy,
  compact,
  allowPlaceholder,
  onChange,
  onTogglePin,
}: {
  id: string;
  models: AgentModelOption[];
  pinned: AgentModelOption[];
  rest: AgentModelOption[];
  value: string | null;
  selectedOption: AgentModelOption | undefined;
  isPinned: boolean;
  busy: boolean;
  compact: boolean;
  allowPlaceholder: boolean;
  onChange: (value: string | null) => void;
  onTogglePin?: (modelId: string) => void;
}) {
  const selectedAvailable = Boolean(selectedOption);
  return (
    <div className="flex items-center gap-1.5">
      <SelectField
        id={id}
        density={compact ? "compact" : "standard"}
        value={selectedAvailable ? (value ?? "") : ""}
        disabled={busy}
        className="min-w-0 flex-1"
        onChange={(event) => onChange(event.target.value || null)}
      >
        {allowPlaceholder && (
          <option value="" disabled>
            {value && !selectedAvailable ? "Configured model unavailable" : "Choose a model"}
          </option>
        )}
        {pinned.length > 0 ? (
          <>
            <optgroup label="Pinned">
              {pinned.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.displayName}
                </option>
              ))}
            </optgroup>
            {rest.length > 0 && (
              <optgroup label="All models">
                {rest.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.displayName}
                  </option>
                ))}
              </optgroup>
            )}
          </>
        ) : (
          models.map((option) => (
            <option key={option.id} value={option.id}>
              {option.displayName}
            </option>
          ))
        )}
      </SelectField>
      {onTogglePin && selectedOption && (
        <PinModelButton
          modelName={selectedOption.displayName}
          pinned={isPinned}
          disabled={busy}
          compact={compact}
          onToggle={() => onTogglePin(selectedOption.id)}
        />
      )}
    </div>
  );
}
