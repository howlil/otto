import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Direction = "forward" | "back";
type Kind = "page" | "tab";
type Frame = { key: string; node: ReactNode };
type ExitFrame = Frame & { direction: Direction };

export function TransitionContent({
  transitionKey,
  direction = "forward",
  kind = "page",
  reducedMotion,
  className = "",
  children,
}: {
  transitionKey: string;
  direction?: Direction;
  kind?: Kind;
  reducedMotion: boolean;
  className?: string;
  children: ReactNode;
}) {
  const latest = useRef<Frame>({ key: transitionKey, node: children });
  const [outgoing, setOutgoing] = useState<ExitFrame | null>(null);

  useLayoutEffect(() => {
    const previous = latest.current;
    if (previous.key !== transitionKey) {
      setOutgoing(reducedMotion ? null : { key: previous.key, node: previous.node, direction });
    } else if (reducedMotion) {
      setOutgoing(null);
    }
    latest.current = { key: transitionKey, node: children };
  }, [transitionKey, direction, reducedMotion, children]);

  useEffect(() => {
    if (!outgoing) return;
    const timer = window.setTimeout(() => {
      setOutgoing((current) => (current === outgoing ? null : current));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [outgoing]);

  const layout = kind === "tab" ? "min-w-0" : "flex h-full min-h-0 w-full flex-col";
  const enter = reducedMotion
    ? ""
    : kind === "tab"
      ? "otto-tab-enter"
      : direction === "back"
        ? "otto-page-back-enter"
        : "otto-page-forward-enter";
  const exit =
    kind === "tab"
      ? "otto-tab-exit"
      : outgoing?.direction === "back"
        ? "otto-page-back-exit"
        : "otto-page-forward-exit";

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div key={transitionKey} className={`${layout} ${enter}`}>
        {children}
      </div>
      {outgoing && !reducedMotion && (
        <div
          aria-hidden="true"
          inert
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 ${layout} ${exit}`}
        >
          {outgoing.node}
        </div>
      )}
    </div>
  );
}
