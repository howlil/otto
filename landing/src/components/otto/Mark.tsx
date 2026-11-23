export type Expression =
  | "idle"
  | "thinking"
  | "working"
  | "listening"
  | "speaking"
  | "completed"
  | "attention"
  | "error";

type Shape = readonly [string, string];

const miniShapes: Record<Expression, Shape> = {
  idle: ["h-3 w-[5px]", "h-3 w-[5px]"],
  thinking: ["h-[11px] w-[5px]", "h-[11px] w-[5px]"],
  working: ["h-[11px] w-[5px]", "h-[11px] w-[5px]"],
  listening: ["h-[13px] w-[6px]", "h-[13px] w-[6px]"],
  speaking: ["h-[11px] w-[6px]", "h-[11px] w-[6px]"],
  completed: [
    "h-[7px] w-[7px] rounded-t-full rounded-b-[3px]",
    "h-[7px] w-[7px] rounded-t-full rounded-b-[3px]",
  ],
  attention: ["h-[10px] w-[5px]", "h-[13px] w-[5px] -translate-y-px"],
  error: ["h-[6px] w-[7px]", "h-[6px] w-[7px]"],
};

const headerShape: Shape = ["h-[14px] w-[10px]", "h-[14px] w-[10px]"];

const motionClass: Record<Expression, string> = {
  idle: "otto-eyes-idle",
  thinking: "otto-eyes-working",
  working: "otto-eyes-working",
  listening: "otto-eyes-listening",
  speaking: "otto-eyes-speaking",
  completed: "otto-eyes-completed",
  attention: "",
  error: "",
};

function Eyes({
  expression,
  mini,
  expressive,
}: {
  expression: Expression;
  mini: boolean;
  expressive: boolean;
}) {
  const shapes = mini ? miniShapes[expression] : headerShape;
  const color = mini ? "bg-otto-agent-eye" : "bg-otto-idle-eye";
  const hover =
    expression === "idle" ? "group-hover:h-3 group-hover:w-[11px] group-hover:-translate-y-px" : "";
  const motion = expressive ? motionClass[expression] : "";
  return (
    <span
      data-eye-expression={expression}
      aria-hidden="true"
      className={`inline-flex h-[23px] flex-none items-center justify-center ${mini ? "w-[23px] gap-1.5" : "w-8 gap-2"} ${motion}`}
    >
      {shapes.map((shape, index) => (
        <i
          key={index}
          className={`otto-eye block flex-none rounded-[7px] ${color} transition-[height,width,transform,border-radius] duration-[190ms] ease-otto ${shape} ${hover}`}
        />
      ))}
    </span>
  );
}

export function OttoMark({
  compact = false,
  expression = "idle",
  expressive = false,
}: {
  compact?: boolean;
  expression?: Expression;
  expressive?: boolean;
}) {
  return (
    <span
      data-otto-logo="true"
      className={`${compact ? "h-7 w-7 rounded-otto-island" : "h-[34px] w-[34px] rounded-otto-panel"} grid flex-none place-items-center bg-otto-raised-soft text-otto-control-text transition-[background] duration-[160ms] ease-otto group-hover:bg-otto-line-mid`}
    >
      <Eyes expression={expression} mini={compact} expressive={expressive} />
    </span>
  );
}

export const circleStates = {
  idle: {
    label: "Idle",
    ring: null,
    tone: "idle",
    expression: "idle",
    pip: null,
    logo: "",
  },
  capturing: {
    label: "Capturing",
    ring: "capturing",
    tone: "capturing",
    expression: "thinking",
    pip: "bg-otto-hljs-function",
    logo: "otto-circle-logo-active",
  },
  streaming: {
    label: "Answering",
    ring: "streaming",
    tone: "working",
    expression: "working",
    pip: "bg-otto-text-bright",
    logo: "otto-circle-logo-active",
  },
  listening: {
    label: "Listening",
    ring: "listening",
    tone: "listening",
    expression: "listening",
    pip: "bg-otto-ok",
    logo: "otto-circle-logo-active",
  },
  speaking: {
    label: "Reading aloud",
    ring: "speaking",
    tone: "speaking",
    expression: "speaking",
    pip: "bg-otto-ok",
    logo: "otto-circle-logo-active",
  },
  completed: {
    label: "Answer ready",
    ring: "completed",
    tone: "completed",
    expression: "completed",
    pip: "bg-otto-ok",
    logo: "otto-circle-logo-complete",
  },
  error: {
    label: "Needs attention",
    ring: "error",
    tone: "error",
    expression: "error",
    pip: "bg-otto-danger",
    logo: "otto-circle-logo-error",
  },
} as const;

export type CircleState = (typeof circleStates)[keyof typeof circleStates];

export function CircleMark({ state, waveKey = 0 }: { state: CircleState; waveKey?: number }) {
  return (
    <span className="group relative grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-full [&_[data-otto-logo]]:bg-transparent">
      {state.ring && (
        <span
          aria-hidden="true"
          className={`otto-circle-ring otto-circle-ring-${state.ring} pointer-events-none absolute inset-[1.5px] rounded-full`}
        />
      )}
      {waveKey > 0 && (
        <span
          key={waveKey}
          aria-hidden="true"
          className={`otto-circle-wave otto-circle-wave-${state.tone} pointer-events-none absolute inset-[1px] rounded-full`}
        />
      )}
      <span className={`relative z-10 flex items-center justify-center ${state.logo}`}>
        <OttoMark compact expression={state.expression} expressive />
      </span>
      {state.pip && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-[3px] left-1/2 z-20 h-1 w-1 -translate-x-1/2 rounded-full ${state.pip}`}
        />
      )}
    </span>
  );
}

export function Bars() {
  return (
    <span aria-hidden="true" className="flex h-3 flex-none items-center gap-[2px]">
      <i className="otto-bar-1 block h-[3px] w-[2px] rounded-full bg-otto-text-secondary" />
      <i className="otto-bar-2 block h-[3px] w-[2px] rounded-full bg-otto-text-secondary" />
      <i className="otto-bar-3 block h-[3px] w-[2px] rounded-full bg-otto-text-secondary" />
      <i className="otto-bar-4 block h-[3px] w-[2px] rounded-full bg-otto-text-secondary" />
    </span>
  );
}
