import { ArrowUp, Camera, ChevronDown, Clock, Mic, Plus, Settings, Square } from "lucide-react";
import type { ReactNode } from "react";
import { Bars, type Expression, OttoMark } from "./Mark";

export function Capsule({
  label,
  detail,
  busy = false,
  onClick,
}: {
  label: string;
  detail: string;
  busy?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-10 w-[228px] max-w-full items-center gap-[9px] bg-transparent px-[11px] text-left text-otto-text"
    >
      <OttoMark compact />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-otto-md leading-[1.2] font-[590]">{label}</span>
        <small className="mt-0.5 block truncate text-otto-xs leading-[1.4] font-normal text-otto-text-secondary">
          {detail}
        </small>
      </span>
      {busy && <Bars />}
    </button>
  );
}

function HeaderIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 flex-none place-items-center rounded-full text-otto-muted"
    >
      {children}
    </span>
  );
}

export function PanelHeader({
  label,
  detail,
  expression = "idle",
  expressive = false,
  onSwitch,
}: {
  label: string;
  detail: string;
  expression?: Expression;
  expressive?: boolean;
  onSwitch?: () => void;
}) {
  return (
    <header className="group flex h-[53px] shrink-0 items-center gap-[9px] px-[15px] pb-[5px] pt-[9px]">
      <OttoMark expression={expression} expressive={expressive} />
      <button
        type="button"
        onClick={onSwitch}
        className="flex min-w-0 flex-1 flex-col rounded-otto-chip bg-transparent px-1.5 py-0.5 text-left transition-colors duration-150 hover:bg-otto-control/70"
      >
        <span className="flex min-w-0 items-center gap-1">
          <strong className="block truncate text-otto-md leading-[1.2] font-[590] text-otto-text">
            {label}
          </strong>
          <ChevronDown size={12} strokeWidth={1.8} className="shrink-0 text-otto-text-tertiary" />
        </span>
        <small className="mt-1 block truncate text-otto-xs leading-[1.4] font-normal text-otto-text-tertiary">
          {detail}
        </small>
      </button>
      <HeaderIcon>
        <Clock size={15} strokeWidth={1.8} />
      </HeaderIcon>
      <HeaderIcon>
        <Plus size={15} strokeWidth={1.8} />
      </HeaderIcon>
      <HeaderIcon>
        <Settings size={15} strokeWidth={1.8} />
      </HeaderIcon>
    </header>
  );
}

function StagedBar({ label, actions }: { label: string; actions: string[] }) {
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-otto-control border border-otto-line-soft bg-otto-field-deep px-2.5 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 rounded-otto-chip border border-otto-line-mid bg-otto-raised-soft px-1.5 py-0.5 text-otto-2xs leading-[1.2] text-otto-text-secondary">
          Snip
        </span>
        <span className="min-w-0 truncate text-otto-2xs leading-[1.2] text-otto-text-bright">
          {label}
        </span>
      </span>
      {actions.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {actions.map((action) => (
            <span
              key={action}
              className="rounded-full border border-otto-line-soft bg-otto-control px-2.5 py-1 text-otto-xs text-otto-text-secondary"
            >
              {action}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function ModePill({ label }: { label: string }) {
  return (
    <span className="inline-flex h-8 flex-none items-center gap-1 rounded-full bg-otto-control px-2.5 text-otto-xs text-otto-text-secondary">
      {label}
      <ChevronDown size={11} strokeWidth={1.8} className="text-otto-text-tertiary" />
    </span>
  );
}

function RoundIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-otto-muted">
      {children}
    </span>
  );
}

export function ModeMenu({
  items,
  active,
}: {
  items: readonly { name: string; slash: string; summary: string }[];
  active: number;
}) {
  return (
    <div className="absolute bottom-full left-3 right-3 z-20 mb-2 overflow-hidden rounded-otto-card border border-otto-line-strong bg-otto-surface p-1 shadow-lg">
      {items.map((item, index) => (
        <div
          key={item.slash}
          className={`flex items-center justify-between gap-3 rounded-otto-control px-2.5 py-1.5 transition-colors duration-150 ${index === active ? "bg-otto-selected" : ""}`}
        >
          <span className="min-w-0">
            <span className="block text-otto-md leading-[1.2] font-[590] text-otto-text">
              {item.name}
            </span>
            <span className="mt-0.5 block truncate text-otto-xs leading-[1.4] text-otto-text-tertiary">
              {item.summary}
            </span>
          </span>
          <span className="flex-none font-mono text-otto-2xs text-otto-text-tertiary">
            {item.slash}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Composer({
  text = "",
  placeholder,
  mode,
  expanded = false,
  staged = null,
  actions = [],
  listening = false,
  busy = false,
  caret = false,
  ready = false,
  menu = null,
}: {
  text?: string;
  placeholder: string;
  mode: string;
  expanded?: boolean;
  staged?: string | null;
  actions?: string[];
  listening?: boolean;
  busy?: boolean;
  caret?: boolean;
  ready?: boolean;
  menu?: ReactNode;
}) {
  const shape = expanded
    ? "min-h-[68px] flex-col gap-0 rounded-[22px] px-[10px] pb-[10px] pt-[10px]"
    : "min-h-[44px] flex-row items-center gap-[5px] rounded-full p-[5px]";
  return (
    <div className="relative shrink-0 px-3 pb-3 pt-[7px]">
      {menu}
      <div className={`flex border border-transparent bg-otto-control-deep ${shape}`}>
        {expanded && staged && <StagedBar label={staged} actions={actions} />}
        <div
          className={`min-w-0 px-1 text-otto-md leading-[1.5] text-otto-text ${expanded ? "block min-h-[19px] w-full" : "min-h-[19px] max-h-[19px] flex-1 truncate"}`}
        >
          {text ? text : <span className="text-otto-text-subtle">{placeholder}</span>}
          {caret && (
            <span
              aria-hidden="true"
              className="otto-caret ml-px inline-block h-[15px] w-[1.5px] translate-y-[3px] bg-otto-text"
            />
          )}
        </div>
        <div
          className={expanded ? "mt-2 flex w-full items-center justify-between gap-1" : "flex shrink-0 items-center gap-1"}
        >
          <div className="flex items-center gap-1">
            {expanded && (
              <RoundIcon>
                <Camera size={15} strokeWidth={1.8} />
              </RoundIcon>
            )}
            <ModePill label={mode} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {listening ? (
              <span className="inline-flex h-8 flex-none items-center gap-1.5 rounded-full border border-otto-ok bg-otto-raised-deep px-2.5 text-otto-xs text-otto-text-bright">
                <span className="h-2 w-2 animate-pulse rounded-full bg-otto-ok" />
                Listening…
              </span>
            ) : (
              <RoundIcon>
                <Mic size={15} strokeWidth={1.8} />
              </RoundIcon>
            )}
            {busy ? (
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-otto-invert-bg text-otto-invert-text">
                <Square size={12} strokeWidth={1.8} fill="currentColor" />
              </span>
            ) : (
              <span
                className={`grid h-8 w-8 flex-none place-items-center rounded-full bg-otto-invert-bg text-otto-invert-text transition-opacity duration-150 ${ready ? "opacity-100" : "opacity-40"}`}
              >
                <ArrowUp size={15} strokeWidth={1.8} />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
