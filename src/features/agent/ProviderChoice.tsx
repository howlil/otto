import { Icon } from "../../shared/ui";
import codexLogo from "../../assets/providers/codex.svg";
import antigravityLogo from "../../assets/providers/antigravity.svg";
import piLogo from "../../assets/providers/pi.svg";
import opencodeLogo from "../../assets/providers/opencode.svg";

export type ProviderName = "Codex" | "Agy" | "Pi" | "OpenCode";

const logos: Record<ProviderName, string> = {
  Codex: codexLogo,
  Agy: antigravityLogo,
  Pi: piLogo,
  OpenCode: opencodeLogo,
};

export function ProviderChoice({
  name,
  command,
  detail,
  status,
  selected,
  locked,
  planned,
  onSelect,
}: {
  name: ProviderName;
  command: string;
  detail: string;
  status: string;
  selected: boolean;
  locked: boolean;
  planned?: boolean;
  onSelect?: () => void;
}) {
  const displayName = name === "Agy" ? "Antigravity" : name;
  return (
    <button
      type="button"
      className={`group min-w-0 overflow-hidden border text-left text-otto-text transition-[background,border-color] duration-200 ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${
        selected
          ? "col-start-1 row-span-3 flex flex-col rounded-otto-launcher border-otto-line-focused bg-otto-selected p-[5px]"
          : "col-start-2 flex items-center gap-2 rounded-otto-card border-otto-line bg-otto-control p-[7px] hover:border-otto-line-hover hover:bg-otto-control-hover"
      } ${planned ? "opacity-60" : ""}`}
      disabled={locked || planned || !onSelect}
      aria-pressed={selected}
      onClick={onSelect}
      title={status}
    >
      {selected ? (
        <>
          <span className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-[11px] bg-[radial-gradient(ellipse_at_50%_40%,var(--color-otto-art-halo),transparent_68%),linear-gradient(150deg,var(--color-otto-art-agent-start),var(--color-otto-art-agent-end))]">
            <span className="pointer-events-none absolute h-[150px] w-[150px] rounded-full border border-otto-line-strong opacity-50 [transform:rotateX(55deg)_rotate(-23deg)]" />
            <span className="absolute left-3 top-[11px] font-otto-mono text-otto-2xs tracking-[0.05em] text-otto-text-tertiary">
              PROVIDER / {name === "Codex" ? "01" : name === "Agy" ? "02" : "03"}
            </span>
            <span className="absolute right-[10px] top-[10px] flex size-5 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
              <Icon name="check" size={12} />
            </span>
            <img
              src={logos[name]}
              alt=""
              className="relative z-10 size-[92px] object-contain [filter:drop-shadow(0_8px_11px_rgba(0,0,0,.23))]"
              draggable={false}
            />
          </span>
          <span className="flex w-full items-end justify-between gap-[7px] px-2 pb-[9px] pt-[13px]">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[17px] font-semibold tracking-[-0.03em]">
                {displayName}
              </span>
              <span className="truncate text-otto-xs text-otto-text-tertiary">{detail}</span>
            </span>
            <span className="shrink-0 rounded-[7px] border border-otto-line-hover px-[7px] py-[5px] font-otto-mono text-otto-xs text-otto-text-secondary">
              {command}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="flex h-full min-h-[52px] w-[54px] shrink-0 items-center justify-center rounded-otto-control bg-[linear-gradient(145deg,var(--color-otto-art-agent-start),var(--color-otto-art-agent-end))] max-[430px]:w-[43px]">
            <img
              src={logos[name]}
              alt=""
              className="size-[36px] object-contain max-[430px]:size-[30px]"
              draggable={false}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-otto-sm font-semibold">{displayName}</span>
            <span className="truncate font-otto-mono text-otto-xs text-otto-muted">
              {command}
            </span>
          </span>
          {planned ? (
            <span className="shrink-0 text-otto-2xs text-otto-muted">Planned</span>
          ) : (
            <span aria-hidden="true" className="shrink-0 text-otto-text-tertiary">›</span>
          )}
        </>
      )}
    </button>
  );
}
