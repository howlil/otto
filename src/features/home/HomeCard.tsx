import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { Text } from "../../shared/ui";

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
  entryMotion = "",
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
  entryMotion?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pointerFrame = useRef<number | null>(null);
  const pending = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    if (!parallax || reduced) {
      const button = buttonRef.current;
      if (button) {
        button.dataset.tracking = "false";
        button.style.setProperty("--dx", "0px");
        button.style.setProperty("--dy", "0px");
      }
    }
    return () => {
      if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current);
      pointerFrame.current = null;
    };
  }, [parallax, reduced]);

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!parallax || reduced) return;
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    pending.current = [
      ((event.clientX - rect.left) / rect.width - 0.5) * amount,
      ((event.clientY - rect.top) / rect.height - 0.5) * amount * 0.7,
    ];
    button.dataset.tracking = "true";
    if (pointerFrame.current !== null) return;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      const [dx, dy] = pending.current;
      button.style.setProperty("--dx", `${dx.toFixed(2)}px`);
      button.style.setProperty("--dy", `${dy.toFixed(2)}px`);
    });
  };
  const reset = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    event.currentTarget.dataset.tracking = "false";
    event.currentTarget.style.setProperty("--dx", "0px");
    event.currentTarget.style.setProperty("--dy", "0px");
  };
  const backgroundClass =
    name === "Agent"
      ? "bg-[linear-gradient(118deg,var(--color-otto-art-music-start)_0%,var(--color-otto-art-music-middle)_51%,var(--color-otto-art-music-end)_100%)]"
      : name === "Music"
        ? "bg-[linear-gradient(118deg,var(--color-otto-art-card-music-start)_0%,var(--color-otto-art-card-music-middle)_51%,var(--color-otto-art-card-music-end)_100%)]"
        : "bg-[linear-gradient(118deg,var(--color-otto-art-card-focus-start)_0%,var(--color-otto-art-card-focus-middle)_51%,var(--color-otto-art-card-focus-end)_100%)]";
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`group relative isolate block h-[76px] min-w-0 overflow-hidden rounded-[15px] border border-otto-line-strong px-[13px] py-[11px] text-left text-otto-text transition-[transform,border-color,background] duration-[260ms] ease-otto [--art-tilt:43deg] [--dx:0px] [--dy:0px] [--shimmer:0.8] before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:bg-[radial-gradient(ellipse_120px_100px_at_78%_30%,var(--color-otto-art-halo),transparent_70%)] before:opacity-[var(--shimmer)] before:mix-blend-screen before:transition-opacity before:duration-[250ms] after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:bg-[linear-gradient(90deg,var(--color-otto-art-overlay-start)_0%,var(--color-otto-art-overlay-middle)_29%,var(--color-otto-art-overlay-end)_64%,transparent_100%)] hover:border-otto-line-hover focus-visible:border-otto-line-hover active:scale-[0.985] ${backgroundClass} ${entryMotion}`}
      onClick={onClick}
      onPointerMove={move}
      onPointerLeave={reset}
      style={{ "--art-tilt": `${tilt}deg`, "--shimmer": String(gradient / 100) } as CSSProperties}
    >
      <span className="pointer-events-none relative z-[3] flex h-full max-w-[81%] flex-col justify-center whitespace-nowrap">
        <strong className="text-otto-md font-[550] leading-[1.2]">{name}</strong>
        <Text as="small" variant="meta" className="mt-1.5 text-otto-text-floating-muted">
          {subtitle}
        </Text>
      </span>
      <img
        className="pointer-events-none absolute right-[-7px] top-[-23px] z-0 h-[132px] w-[148px] select-none object-contain opacity-[0.91] [transform:perspective(380px)_rotateY(calc(-1*var(--art-tilt)))_rotateZ(-6deg)_translate3d(var(--dx),var(--dy),0)] [transform-origin:60%_50%] transition-[transform,opacity] duration-[370ms] ease-otto group-hover:opacity-100 group-data-[tracking=true]:transition-opacity group-data-[tracking=true]:duration-[240ms]"
        src={artwork}
        alt=""
        draggable={false}
      />
    </button>
  );
}
