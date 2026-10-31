import type { CSSProperties, PointerEvent } from "react";

// One launcher card. Render-only: it takes the artwork and pointer settings as
// props and reports the open intent. The parallax offsets are visual state, so
// they stay on the element, never in a store.
export function HomeCard({
  name,
  subtitle,
  artwork,
  onClick,
  parallax,
  reduced,
  amount,
  tilt,
  gradient,
}: {
  name: string;
  subtitle: string;
  artwork: string;
  onClick: () => void;
  parallax: boolean;
  reduced: boolean;
  amount: number;
  tilt: number;
  gradient: number;
}) {
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!parallax || reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--dx",
      ((event.clientX - rect.left) / rect.width - 0.5) * amount + "px",
    );
    event.currentTarget.style.setProperty(
      "--dy",
      ((event.clientY - rect.top) / rect.height - 0.5) * amount * 0.7 + "px",
    );
  };
  const reset = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty("--dx", "0px");
    event.currentTarget.style.setProperty("--dy", "0px");
  };
  return (
    <button
      type="button"
      className={`otto-choice otto-choice-${name.toLowerCase()} relative isolate block min-w-0 overflow-hidden text-left text-otto-text`}
      onClick={onClick}
      onPointerMove={move}
      onPointerLeave={reset}
      style={{ "--art-tilt": `${tilt}deg`, "--shimmer": String(gradient / 100) } as CSSProperties}
    >
      <span className="otto-choice-copy pointer-events-none relative z-[3] flex h-full flex-col justify-center whitespace-nowrap">
        <strong>{name}</strong>
        <small>{subtitle}</small>
      </span>
      <img
        className="otto-choice-art pointer-events-none absolute z-0 select-none object-contain"
        src={artwork}
        alt=""
        draggable={false}
      />
    </button>
  );
}
