import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type TransitionKind = "page" | "tab" | "compact";
type Direction = "forward" | "back" | "center";
type Frame = { key: string; node: ReactNode };

export function TransitionContent({
  transitionKey,
  kind = "page",
  direction = "forward",
  reducedMotion,
  className = "",
  children,
}: {
  transitionKey: string;
  kind?: TransitionKind;
  direction?: Direction;
  reducedMotion: boolean;
  className?: string;
  children: ReactNode;
}) {
  const latest = useRef<Frame>({ key: transitionKey, node: children });
  const [retained, setRetained] = useState<Frame | null>(null);
  const switching = latest.current.key !== transitionKey;
  const outgoing = reducedMotion ? null : switching ? latest.current : retained;

  useLayoutEffect(() => {
    if (latest.current.key !== transitionKey) {
      setRetained(reducedMotion ? null : latest.current);
    } else if (reducedMotion) {
      setRetained(null);
    }
    latest.current = { key: transitionKey, node: children };
  }, [transitionKey, children, reducedMotion]);

  useEffect(() => {
    if (!retained) return;
    const timer = window.setTimeout(
      () => setRetained((current) => (current === retained ? null : current)),
      kind === "compact" ? 280 : kind === "tab" ? 140 : 160,
    );
    return () => window.clearTimeout(timer);
  }, [retained, kind]);

  const isTab = kind === "tab";
  const layout = isTab ? "min-w-0" : "flex h-full min-h-0 w-full flex-col";
  const enter = reducedMotion
    ? ""
    : isTab
      ? "otto-tab-enter"
      : kind === "compact"
        ? "otto-compact-enter"
        : direction === "center"
          ? "otto-page-center-enter"
          : direction === "back"
            ? "otto-page-back-enter"
            : "otto-page-forward-enter";
  const exit = isTab
    ? "otto-tab-exit"
    : kind === "compact"
      ? "otto-compact-exit"
      : direction === "center"
        ? "otto-page-center-exit"
        : direction === "back"
          ? "otto-page-back-exit"
          : "otto-page-forward-exit";

  return (
    <div className={`relative min-w-0 ${className}`}>
      {outgoing && outgoing.key !== transitionKey && (
        <div
          key={outgoing.key}
          aria-hidden="true"
          inert
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 ${layout} ${exit}`}
        >
          {outgoing.node}
        </div>
      )}
      <div key={transitionKey} className={`${layout} ${enter}`}>
        {children}
      </div>
    </div>
  );
}
