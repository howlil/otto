import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";

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
  return (
    <button
      ref={buttonRef}
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
