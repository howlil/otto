import type { CSSProperties } from "react";
import { Text } from "../../shared/ui";

export function HomeCard({
  name,
  subtitle,
  artwork,
  onClick,
  tilt,
  gradient,
  entryMotion = "",
}: {
  name: string;
  subtitle: string;
  artwork: string;
  onClick: () => void;
  tilt: number;
  gradient: number;
  entryMotion?: string;
}) {
  const backgroundClass =
    name === "Agent"
      ? "bg-[linear-gradient(118deg,var(--color-otto-art-music-start)_0%,var(--color-otto-art-music-middle)_51%,var(--color-otto-art-music-end)_100%)]"
      : name === "Music"
        ? "bg-[linear-gradient(118deg,var(--color-otto-art-card-music-start)_0%,var(--color-otto-art-card-music-middle)_51%,var(--color-otto-art-card-music-end)_100%)]"
        : "bg-[linear-gradient(118deg,var(--color-otto-art-card-focus-start)_0%,var(--color-otto-art-card-focus-middle)_51%,var(--color-otto-art-card-focus-end)_100%)]";
  return (
    <button
      type="button"
      className={`group relative isolate block h-[76px] min-w-0 overflow-hidden rounded-[15px] border border-otto-home-card-border py-[11px] pl-[13px] pr-[10px] text-left text-otto-text transition-[border-color,background] duration-[260ms] ease-otto [--art-tilt:43deg] before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:bg-[radial-gradient(ellipse_120px_98px_at_78%_25%,var(--color-otto-art-halo),transparent_72%)] before:opacity-100 before:mix-blend-screen after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:bg-[linear-gradient(90deg,var(--color-otto-art-overlay-start)_0%,var(--color-otto-art-overlay-middle)_29%,var(--color-otto-art-overlay-end)_64%,transparent_100%)] hover:border-otto-line-hover focus-visible:border-otto-line-hover ${backgroundClass} ${entryMotion}`}
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
