import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type IndicatorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function sameRect(left: IndicatorRect | null, right: IndicatorRect) {
  return (
    left?.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function ActiveIndicatorGroup({
  activeKey,
  children,
  className = "",
  indicatorClassName = "",
}: {
  activeKey: string;
  children: ReactNode;
  className?: string;
  indicatorClassName?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorRect | null>(null);

  const measure = useCallback(() => {
    const group = groupRef.current;
    if (!group) return;
    const active = Array.from(group.querySelectorAll<HTMLElement>("[data-active-key]")).find(
      (element) => element.dataset.activeKey === activeKey,
    );
    if (!active) return;
    const groupRect = group.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const next = {
      x: activeRect.left - groupRect.left,
      y: activeRect.top - groupRect.top,
      width: activeRect.width,
      height: activeRect.height,
    };
    setIndicator((current) => (sameRect(current, next) ? current : next));
  }, [activeKey]);

  useLayoutEffect(() => {
    measure();
    const group = groupRef.current;
    if (!group) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    const active = Array.from(group.querySelectorAll<HTMLElement>("[data-active-key]")).find(
      (element) => element.dataset.activeKey === activeKey,
    );
    if (active) observer.observe(active);
    return () => observer.disconnect();
  }, [activeKey, measure]);

  return (
    <div ref={groupRef} className={["relative", className].filter(Boolean).join(" ")}>
      {indicator && (
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none absolute left-0 top-0 z-0 will-change-transform motion-safe:transition-[transform,width,height] motion-safe:duration-[var(--otto-selection-duration)] motion-safe:ease-otto motion-reduce:transition-none",
            indicatorClassName,
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            height: indicator.height,
            width: indicator.width,
            transform: ["translate3d(", indicator.x, "px, ", indicator.y, "px, 0)"].join(""),
          }}
        />
      )}
      {children}
    </div>
  );
}
