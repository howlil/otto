import { Icon } from "../../shared/ui";
import codexLogo from "../../assets/providers/codex.svg";
import antigravityLogo from "../../assets/providers/antigravity.svg";
import piLogo from "../../assets/providers/pi.svg";

export type ProviderName = "Codex" | "Agy" | "Pi";

const logos: Record<ProviderName, string> = {
  Codex: codexLogo,
  Agy: antigravityLogo,
  Pi: piLogo,
};

export function ProviderChoice({
  name,
  command,
  status,
  selected,
  locked,
  onSelect,
}: {
  name: ProviderName;
  command: string;
  status: string;
  selected: boolean;
  locked: boolean;
  onSelect?: () => void;
}) {
  const displayName = name === "Agy" ? "Antigravity" : name;
  return (
    <button
      type="button"
      className={`group flex min-h-[82px] min-w-0 flex-col items-center justify-center gap-2 rounded-otto-card border p-2 text-center text-otto-text transition-[background,border-color] duration-200 ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${selected ? "border-otto-line-focused bg-otto-selected" : "border-otto-line bg-otto-control hover:border-otto-line-hover hover:bg-otto-control-hover"}`}
      disabled={locked || !onSelect}
      aria-pressed={selected}
      onClick={onSelect}
      title={status}
    >
      <span className="relative flex size-9 items-center justify-center rounded-otto-control bg-otto-raised-deep">
        <img src={logos[name]} alt="" className="size-7 object-contain" draggable={false} />
        {selected && (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
            <Icon name="check" size={10} />
          </span>
        )}
      </span>
      <span className="min-w-0 max-w-full truncate text-otto-sm font-semibold">{displayName}</span>
      <span className="max-w-full truncate font-otto-mono text-otto-xs text-otto-muted">
        {command}
      </span>
    </button>
  );
}
