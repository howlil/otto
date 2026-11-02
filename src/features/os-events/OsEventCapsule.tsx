import { Icon } from "../../shared/ui";
import type { OsEventView } from "../../platform/tauri";
import { presentOsEvent, type OsEventTone } from "./view-model";

const toneClass: Record<OsEventTone, string> = {
  neutral: "text-otto-muted",
  positive: "text-otto-ok",
  warning: "text-otto-warn",
  critical: "text-otto-danger",
};

const barHeights = ["h-[6px]", "h-[11px]", "h-[15px]", "h-[9px]", "h-[5px]"];
const barDelays = [
  "[animation-delay:0ms]",
  "[animation-delay:30ms]",
  "[animation-delay:60ms]",
  "[animation-delay:90ms]",
  "[animation-delay:120ms]",
];

export function OsEventCapsule({ event }: { event: OsEventView }) {
  const view = presentOsEvent(event);
  return (
    <div
      role="status"
      className="flex h-full w-full items-center gap-[11px] overflow-hidden px-[13px] text-otto-text"
    >
      <Icon name={view.icon} size={19} />
      <div className="min-w-0">
        <strong className="block truncate text-[11px] font-semibold leading-tight">
          {view.label}
        </strong>
        <small className={`block truncate text-[10px] leading-tight ${toneClass[view.tone]}`}>
          {view.status}
        </small>
      </div>
      {view.meter ? (
        <span aria-hidden className="event-meter ml-auto flex h-[19px] items-end gap-[3px]">
          {barHeights.map((height, index) => (
            <i
              key={height}
              className={`w-[3px] rounded-[3px] bg-otto-text ${height} ${barDelays[index]}`}
            />
          ))}
        </span>
      ) : null}
    </div>
  );
}
