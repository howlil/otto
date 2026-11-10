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

type TransitionKind = "page" | "tab" | "compact" | "module";
type Direction = "forward" | "back" | "center";
type FrameSize = { width: number; height: number } | null | undefined;
type Frame = { key: string; node: ReactNode; size: FrameSize };

function frameStyle(size: FrameSize): CSSProperties | undefined {
  return size ? { width: size.width, height: size.height } : undefined;
}

function transitionClasses(kind: TransitionKind, direction: Direction): [string, string] {
  if (kind === "module") {
    const side = direction === "back" ? "back" : "forward";
    return [`otto-module-${side}-enter`, `otto-module-${side}-exit`];
  }
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
  children,
}: {
  transitionKey: string;
  kind?: TransitionKind;
  direction?: Direction;
  reducedMotion: boolean;
  className?: string;
  frameSize?: FrameSize;
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
      kind === "compact" ? 160 : kind === "tab" ? 140 : 160,
    );
    return () => window.clearTimeout(timer);
  }, [retained, kind]);

  const isTab = kind === "tab";
  const layout = isTab ? "min-w-0" : "flex h-full min-h-0 w-full flex-col";
  const [incoming, exit] = transitionClasses(kind, direction);
  const enter = reducedMotion ? "" : incoming;

  return (
    <div className={`relative min-w-0 ${className}`}>
      {outgoing && outgoing.key !== transitionKey && (
        <div
          key={outgoing.key}
          aria-hidden="true"
          inert
          className={`pointer-events-none absolute left-0 top-0 z-10 ${layout} ${exit}`}
          style={frameStyle(outgoing.size)}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            setRetained((current) => (current?.key === outgoing.key ? null : current));
          }}
        >
          <TransitionActivity.Provider value={false}>{outgoing.node}</TransitionActivity.Provider>
        </div>
      )}
      <div key={transitionKey} className={`${layout} ${enter}`} style={frameStyle(frameSize)}>
        <TransitionActivity.Provider value={active}>{children}</TransitionActivity.Provider>
      </div>
    </div>
  );
}
