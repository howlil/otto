import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const TransitionActivity = createContext(true);

export function useTransitionActive(): boolean {
  return useContext(TransitionActivity);
}

type TransitionKind = "page" | "tab" | "compact";
type Direction = "forward" | "back" | "center";
type FrameSize = { width: number; height: number } | null | undefined;
type TransitionAnchor = { horizontal: "left" | "center" | "right"; vertical: "top" | "bottom" };
type Frame = { key: string; node: ReactNode; size: FrameSize };

function frameStyle(size: FrameSize, anchor?: TransitionAnchor): CSSProperties | undefined {
  if (!size) return undefined;
  const horizontal = anchor?.horizontal ?? "center";
  if (horizontal === "left") return { width: size.width, height: size.height, left: 0 };
  if (horizontal === "right") return { width: size.width, height: size.height, right: 0 };
  return { width: size.width, height: size.height, left: "50%", marginLeft: -size.width / 2 };
}

function transitionClasses(kind: TransitionKind, direction: Direction): [string, string] {
  if (kind === "tab") return ["otto-tab-enter", "otto-tab-exit"];
  if (kind === "compact") return ["otto-compact-enter", "otto-compact-exit"];
  return [`otto-page-${direction}-enter`, `otto-page-${direction}-exit`];
}

export function TransitionContent({
  transitionKey,
  kind = "page",
  direction = "forward",
  reducedMotion,
  className = "",
  frameSize,
  anchor,
  children,
}: {
  transitionKey: string;
  kind?: TransitionKind;
  direction?: Direction;
  reducedMotion: boolean;
  className?: string;
  frameSize?: FrameSize;
  anchor?: TransitionAnchor;
  children: ReactNode;
}) {
  const active = useTransitionActive();
  const latest = useRef<Frame>({ key: transitionKey, node: children, size: frameSize });
  const [retained, setRetained] = useState<Frame | null>(null);
  const switching = latest.current.key !== transitionKey;
  const outgoing = reducedMotion ? null : switching ? latest.current : retained;

  useLayoutEffect(() => {
    if (latest.current.key !== transitionKey) {
      setRetained(reducedMotion ? null : latest.current);
    } else if (reducedMotion) {
      setRetained(null);
    }
    latest.current = { key: transitionKey, node: children, size: frameSize };
  }, [transitionKey, children, frameSize, reducedMotion]);

  useEffect(() => {
    if (!retained) return;
    const timer = window.setTimeout(
      () => setRetained((current) => (current === retained ? null : current)),
      kind === "compact" ? 130 : kind === "tab" ? 130 : 170,
    );
    return () => window.clearTimeout(timer);
  }, [retained, kind]);

  const isTab = kind === "tab";
  const layout = isTab ? "min-w-0" : "flex h-full min-h-0 w-full flex-col";
  const [incoming, exit] = transitionClasses(kind, direction);
  const enter = reducedMotion ? "" : incoming;

  const bottomAnchor = anchor?.vertical === "bottom";
  const rightAnchor = anchor?.horizontal === "right";
  const verticalClass = bottomAnchor ? "bottom-0" : "top-0";

  return (
    <div className={`relative min-w-0 ${className}`}>
      {outgoing && outgoing.key !== transitionKey && (
        <div
          key={outgoing.key}
          aria-hidden="true"
          inert
          className={`pointer-events-none absolute ${verticalClass} z-10 ${outgoing.size ? "" : "left-0"} ${layout} ${exit}`}
          style={frameStyle(outgoing.size, anchor)}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            setRetained((current) => (current?.key === outgoing.key ? null : current));
          }}
        >
          <TransitionActivity.Provider value={false}>{outgoing.node}</TransitionActivity.Provider>
        </div>
      )}
      <div
        key={transitionKey}
        className={`${frameSize ? (bottomAnchor || rightAnchor ? `absolute ${verticalClass}` : "relative") : ""} ${layout} ${enter}`}
        style={frameStyle(frameSize, anchor)}
      >
        <TransitionActivity.Provider value={active}>{children}</TransitionActivity.Provider>
      </div>
    </div>
  );
}
