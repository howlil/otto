import { useEffect, useRef, useState } from "react";
import type { AgentModelOption } from "../../../platform/tauri";
import { TextField, VisuallyHidden } from "../../../shared/ui";
import { FilteredModelList, PinnedModelChips } from "./ModelPickerList";
import { ModelSelectRow } from "./ModelSelectRow";
import { sortAndFilterModels } from "./model-picker";

const SEARCH_THRESHOLD = 5;

export function ModelPicker({
  id,
  models,
  value,
  pinnedModels = [],
  onTogglePin,
  busy,
  compact = false,
  autoFocusSearch = false,
  allowPlaceholder = false,
  onChange,
}: {
  id: string;
  models: AgentModelOption[];
  value: string | null;
  pinnedModels?: readonly string[];
  onTogglePin?: (modelId: string) => void;
  busy: boolean;
  compact?: boolean;
  autoFocusSearch?: boolean;
  allowPlaceholder?: boolean;
  onChange: (value: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = models.length >= SEARCH_THRESHOLD;
  const { pinned, rest, filtered } = sortAndFilterModels(models, pinnedModels, query);
  const pinnedSet = new Set(pinnedModels);
  const selectedOption = models.find((option) => option.id === value);
  const hasQuery = Boolean(query.trim());

  useEffect(() => {
    if (autoFocusSearch && showSearch) {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocusSearch, showSearch]);

  const handleFilteredSelect = (nextId: string) => {
    setQuery("");
    onChange(nextId);
  };

  return (
    <div className="space-y-1.5">
      {!hasQuery && (
        <PinnedModelChips options={pinned} value={value} busy={busy} onSelect={onChange} />
      )}
      {showSearch && (
        <div className="relative">
          <label htmlFor={`${id}-filter`}>
            <VisuallyHidden>Filter models</VisuallyHidden>
          </label>
          <TextField
            ref={searchRef}
            id={`${id}-filter`}
            type="search"
            density="compact"
            value={query}
            disabled={busy}
            placeholder="Filter models…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && filtered.length > 0) {
                event.preventDefault();
                handleFilteredSelect(filtered[0].id);
              }
            }}
          />
        </div>
      )}
      {hasQuery ? (
        <FilteredModelList
          options={filtered}
          value={value}
          pinnedSet={pinnedSet}
          busy={busy}
          onSelect={handleFilteredSelect}
          onTogglePin={onTogglePin}
        />
      ) : (
        <ModelSelectRow
          id={id}
          models={models}
          pinned={pinned}
          rest={rest}
          value={value}
          selectedOption={selectedOption}
          isPinned={Boolean(selectedOption && pinnedSet.has(selectedOption.id))}
          busy={busy}
          compact={compact}
          allowPlaceholder={allowPlaceholder}
          onChange={onChange}
          onTogglePin={onTogglePin}
        />
      )}
    </div>
  );
}
