import type { CSSProperties } from "react";
import { Text } from "../../shared/ui";

export function HomeCard({
  name,
  subtitle,
  artwork,
  onClick,
  disabled = false,
  tilt,
  gradient,
  entryMotion = "",
}: {
  name: string;
  subtitle: string;
  artwork: string;
  onClick?: () => void;
  disabled?: boolean;
  tilt: number;
  gradient: number;
  entryMotion?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      className={`group relative isolate block h-[76px] min-w-0 overflow-hidden rounded-otto-launcher border border-otto-home-card-border bg-otto-raised-soft p-3 text-left text-otto-text transition-[border-color] duration-[260ms] ease-otto [--art-tilt:43deg] after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:bg-[linear-gradient(90deg,var(--color-otto-raised-soft)_0%,transparent_82%)] enabled:hover:border-otto-line-hover focus-visible:border-otto-line-hover disabled:cursor-not-allowed ${entryMotion}`}
      onClick={onClick}
      style={
        { "--art-tilt": `${tilt}deg`, "--art-opacity": String(gradient / 100) } as CSSProperties
      }
    >
      <span className="pointer-events-none relative z-[3] flex h-full max-w-[81%] flex-col justify-center whitespace-nowrap">
        <strong className="text-otto-home-card-title text-otto-md font-[550] leading-[1.2]">
          {name}
        </strong>
        <Text as="small" variant="meta" className="mt-1.5 text-otto-home-card-subtitle">
          {subtitle}
        </Text>
      </span>
      <img
        className="pointer-events-none absolute right-[-7px] top-[-23px] z-0 h-[132px] w-[148px] select-none object-contain opacity-[var(--art-opacity)] [transform:perspective(380px)_rotateY(calc(-1*var(--art-tilt)))_rotateZ(-6deg)] [transform-origin:60%_50%] transition-opacity duration-[240ms] ease-otto group-hover:opacity-100"
        src={artwork}
        alt=""
        draggable={false}
      />
    </button>
  );
}
