import { Copy, RefreshCw, Square, TextCursorInput, Volume2 } from "lucide-react";
import type { ReactNode } from "react";

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto max-w-[87%] whitespace-pre-wrap rounded-[12px_12px_4px_12px] bg-otto-raised-soft px-[11px] py-[9px] text-otto-sm leading-[1.5] text-otto-text-soft-white [overflow-wrap:anywhere]">
      {children}
    </div>
  );
}

export function AnswerText({ children, caret = false }: { children: ReactNode; caret?: boolean }) {
  return (
    <div className="md-body">
      {children}
      {caret && (
        <span
          aria-hidden="true"
          className="otto-caret ml-px inline-block h-[14px] w-[1.5px] translate-y-[2px] bg-otto-text"
        />
      )}
    </div>
  );
}

const actionClass =
  "inline-flex min-h-7 items-center gap-1.5 py-[5px] text-otto-xs text-otto-muted-strong transition-colors duration-150";

export function TurnActions({
  speaking = false,
  inserted = false,
  chips = [],
}: {
  speaking?: boolean;
  inserted?: boolean;
  chips?: string[];
}) {
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-[9px]">
        <span className={actionClass}>
          <Copy size={13} strokeWidth={1.8} />
          Copy
        </span>
        <span className={`${actionClass} ${speaking ? "text-otto-text" : ""}`}>
          {speaking ? (
            <Square size={11} strokeWidth={1.8} fill="currentColor" />
          ) : (
            <Volume2 size={13} strokeWidth={1.8} />
          )}
          {speaking ? "Stop" : "Listen"}
        </span>
        <span className={`${actionClass} ${inserted ? "text-otto-ok" : ""}`}>
          <TextCursorInput size={13} strokeWidth={1.8} />
          {inserted ? "Inserted" : "Insert"}
        </span>
        <span className={actionClass}>
          <RefreshCw size={13} strokeWidth={1.8} />
          Retry
        </span>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-otto-line-soft bg-otto-control px-2.5 py-1 text-otto-xs text-otto-text-secondary"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 flex-none text-otto-text-secondary"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function PermissionCard({
  engine,
  title,
  summary,
  onDecline,
  onAllow,
}: {
  engine: string;
  title: string;
  summary?: string;
  onDecline?: () => void;
  onAllow?: () => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 rounded-otto-card border border-otto-line-mid bg-otto-control px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertIcon />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="m-0 text-otto-sm leading-[1.35] font-medium text-otto-text">
            {`${engine} is asking permission`}
          </p>
          <p className="m-0 break-words text-otto-md leading-[1.6] text-otto-text-secondary">{title}</p>
          {summary && (
            <p className="m-0 break-words text-otto-xs leading-[1.4] text-otto-text-tertiary">{summary}</p>
          )}
          <p className="m-0 text-otto-2xs leading-[1.2] text-otto-text-subtle">
            Otto never approves actions automatically.
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDecline}
          className="inline-flex h-7 items-center rounded-full border border-otto-line-strong bg-otto-raised-soft px-2.5 text-otto-xs text-otto-text-bright transition-colors duration-150 hover:bg-otto-control-hover"
        >
          Decline &amp; continue
        </button>
        <button
          type="button"
          onClick={onAllow}
          className="inline-flex h-7 items-center rounded-full bg-otto-invert-bg px-2.5 text-otto-xs font-medium text-otto-invert-text transition-opacity duration-150 hover:opacity-90"
        >
          Allow once
        </button>
      </div>
    </fieldset>
  );
}
