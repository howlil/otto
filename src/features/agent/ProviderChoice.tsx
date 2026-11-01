import { Text } from "../../shared/ui";

export type ProviderTone = "codex" | "agy" | "pi";

const markVariants: Record<ProviderTone, string> = {
  codex: "text-otto-completion-soft",
  agy: "text-otto-text-bright",
  pi: "font-serif text-otto-xl",
};

export function ProviderChoice({
  name,
  mark,
  tone,
  status,
  selected,
  onSelect,
}: {
  name: string;
  mark: string;
  tone: ProviderTone;
  status: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  const className = `relative flex min-h-[59px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-otto-control border px-1.5 py-2 text-center text-otto-text-bright leading-[1.2] transition-[background,border-color,transform] duration-150 ${selected ? "border-otto-line-focused bg-otto-selected" : "border-otto-line-mid bg-otto-control opacity-[0.56]"}`;
  const content = (
    <>
      <span
        className={`grid h-5 w-5 place-items-center rounded-[6px] bg-otto-control-deep text-otto-sm font-semibold leading-none ${markVariants[tone]}`}
        aria-hidden="true"
      >
        {mark}
      </span>
      <span className="flex min-w-0 flex-col items-center gap-0.5">
        <Text
          as="strong"
          variant="label"
          className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {name}
        </Text>
        <Text
          as="small"
          variant="caption"
          className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-otto-label-muted"
        >
          {status}
        </Text>
      </span>
      {selected && (
        <i
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-otto-ok"
          aria-hidden="true"
        />
      )}
    </>
  );
  if (!onSelect) {
    return (
      <div
        className={className}
        title={selected ? `${name} provider selected` : `${name} provider coming soon`}
        aria-current={selected ? "true" : undefined}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${className} hover:border-otto-line-hover hover:bg-otto-control-hover active:scale-[0.985]`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {content}
    </button>
  );
}
