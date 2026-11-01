import { Icon, Text } from "../../shared/ui";

export function ProviderChoice({
  name,
  detail,
  status,
  selected,
  onSelect,
}: {
  name: string;
  detail: string;
  status: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  const className = `flex min-h-[43px] w-full items-center gap-[10px] rounded-[10px] border px-[10px] py-2 text-left text-otto-text transition-[background,border-color] duration-150 ${selected ? "border-otto-line-muted bg-otto-selected" : "border-otto-line-mid bg-otto-control"}`;
  const content = (
    <>
      <span className="shrink-0 text-otto-text-secondary" aria-hidden="true">
        <Icon name="terminal" size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <Text as="strong" variant="label" className="block font-[550]">
          {name}
        </Text>
        <Text
          as="small"
          variant="caption"
          className="mt-1 block leading-[1.4] text-otto-text-tertiary"
        >
          {detail}
        </Text>
      </span>
      {selected && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-otto-ok" aria-hidden="true" />
      )}
    </>
  );
  if (!onSelect) {
    return (
      <div className={className} title={status} aria-current={selected ? "true" : undefined}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${className} hover:border-otto-line-hover hover:bg-otto-control-hover`}
      onClick={onSelect}
      aria-pressed={selected}
      title={status}
    >
      {content}
    </button>
  );
}
