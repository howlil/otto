import type { AgentModelOption } from "../../../platform/tauri";
import { Icon, Text, VisuallyHidden } from "../../../shared/ui";

export function PinModelButton({
  modelName,
  pinned,
  disabled,
  compact,
  onToggle,
}: {
  modelName: string;
  pinned: boolean;
  disabled: boolean;
  compact: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      disabled={disabled}
      onClick={onToggle}
      title={pinned ? `Unpin ${modelName}` : `Pin ${modelName}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-otto-control border transition-colors duration-150 disabled:opacity-50 ${
        compact ? "h-[29px] w-[29px]" : "h-[35px] w-[35px]"
      } ${
        pinned
          ? "border-otto-line-focused bg-otto-selected text-otto-text-bright"
          : "border-otto-line-mid bg-otto-field-deep text-otto-text-tertiary hover:bg-otto-control-hover hover:text-otto-text-secondary"
      }`}
    >
      <Icon name="pin" size={13} />
      <VisuallyHidden>{pinned ? `Unpin ${modelName}` : `Pin ${modelName}`}</VisuallyHidden>
    </button>
  );
}

export function PinnedModelChips({
  options,
  value,
  busy,
  onSelect,
}: {
  options: AgentModelOption[];
  value: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            disabled={busy}
            onClick={() => onSelect(option.id)}
            className={`inline-flex h-6 max-w-full items-center gap-1 rounded-otto-chip border px-2 text-otto-xs font-medium transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-otto-line-focused disabled:opacity-50 ${
              active
                ? "border-otto-line-focused bg-otto-selected text-otto-text-bright"
                : "border-otto-line-soft bg-otto-ink-deep text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text-bright"
            }`}
          >
            <Icon name="pin" size={10} className="shrink-0 text-otto-text-tertiary" />
            <span className="truncate">{option.displayName}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FilteredModelList({
  options,
  value,
  pinnedSet,
  busy,
  onSelect,
  onTogglePin,
}: {
  options: AgentModelOption[];
  value: string | null;
  pinnedSet: Set<string>;
  busy: boolean;
  onSelect: (id: string) => void;
  onTogglePin?: (id: string) => void;
}) {
  if (options.length === 0) {
    return (
      <div className="rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2.5 py-2">
        <Text as="p" variant="caption" className="m-0 text-otto-text-tertiary">
          No matching models.
        </Text>
      </div>
    );
  }
  return (
    <div className="otto-scrollbar-hidden max-h-[144px] space-y-0.5 overflow-y-auto rounded-otto-control border border-otto-line-mid bg-otto-field-deep p-1">
      {options.map((option) => {
        const active = option.id === value;
        const pinned = pinnedSet.has(option.id);
        return (
          <div key={option.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              aria-pressed={active}
              onClick={() => onSelect(option.id)}
              className={`min-w-0 flex-1 truncate rounded-otto-chip px-2 py-1 text-left text-otto-sm transition-colors duration-150 disabled:opacity-50 ${
                active
                  ? "bg-otto-selected text-otto-text-bright"
                  : "text-otto-text-secondary hover:bg-otto-control-hover hover:text-otto-text"
              }`}
            >
              {option.displayName}
            </button>
            {onTogglePin && (
              <button
                type="button"
                aria-pressed={pinned}
                disabled={busy}
                onClick={() => onTogglePin(option.id)}
                title={pinned ? `Unpin ${option.displayName}` : `Pin ${option.displayName}`}
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-otto-chip transition-colors duration-150 disabled:opacity-50 ${
                  pinned
                    ? "text-otto-text-bright hover:bg-otto-control-hover"
                    : "text-otto-text-tertiary hover:bg-otto-control-hover hover:text-otto-text-secondary"
                }`}
              >
                <Icon name="pin" size={11} />
                <VisuallyHidden>
                  {pinned ? `Unpin ${option.displayName}` : `Pin ${option.displayName}`}
                </VisuallyHidden>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
