import type { IconName } from "../../shared/ui";
import type { OsEventView } from "../../platform/tauri";

export type OsEventTone = "neutral" | "positive" | "warning" | "critical";

export type OsEventPresentation = {
  icon: IconName;
  label: string;
  status: string;
  tone: OsEventTone;
  meter: boolean;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const levelText = (percent: number | null) =>
  percent === null ? "" : ` ${clampPercent(percent)}%`;

function volumeView(event: Extract<OsEventView, { class: "volume" }>): OsEventPresentation {
  return {
    icon: "volume",
    label: "Volume",
    status: event.muted ? "Muted" : `${clampPercent(event.percent)}%`,
    tone: event.muted ? "warning" : "neutral",
    meter: true,
  };
}

function brightnessView(event: Extract<OsEventView, { class: "brightness" }>): OsEventPresentation {
  return {
    icon: "brightness",
    label: "Brightness",
    status: `${clampPercent(event.percent)}%`,
    tone: "neutral",
    meter: true,
  };
}

function wifiView(event: Extract<OsEventView, { class: "wifi" }>): OsEventPresentation {
  return {
    icon: "wifi",
    label: "Wi-Fi",
    status: event.connected ? "Connected" : "Disconnected",
    tone: event.connected ? "positive" : "warning",
    meter: false,
  };
}

function peripheralView(event: Extract<OsEventView, { class: "bluetooth" }>): OsEventPresentation {
  const audio = event.kind === "audio";
  return {
    icon: audio ? "headphones" : "bluetooth",
    label: event.name ?? (audio ? "Audio device" : "Bluetooth device"),
    status: event.connected ? "Connected" : "Disconnected",
    tone: event.connected ? "positive" : "warning",
    meter: false,
  };
}

function batteryTone(event: Extract<OsEventView, { class: "battery" }>): OsEventTone {
  if (event.critical) return "critical";
  if (event.low) return "warning";
  return event.plugged ? "positive" : "neutral";
}

function batteryIcon(event: Extract<OsEventView, { class: "battery" }>): IconName {
  if (event.charging) return "batteryCharging";
  if (event.low || event.critical) return "batteryLow";
  return "battery";
}

function batteryStatus(event: Extract<OsEventView, { class: "battery" }>): string {
  const percent = levelText(event.percent);
  if (event.charging) return `Charging${percent}`;
  if (event.plugged) return `Plugged in${percent}`;
  if (event.critical) return `Critical${percent}`;
  if (event.low) return `Low${percent}`;
  return `On battery${percent}`;
}

function batteryView(event: Extract<OsEventView, { class: "battery" }>): OsEventPresentation {
  return {
    icon: batteryIcon(event),
    label: "Battery",
    status: batteryStatus(event),
    tone: batteryTone(event),
    meter: false,
  };
}

export function presentOsEvent(event: OsEventView): OsEventPresentation {
  switch (event.class) {
    case "volume":
      return volumeView(event);
    case "brightness":
      return brightnessView(event);
    case "wifi":
      return wifiView(event);
    case "bluetooth":
      return peripheralView(event);
    case "battery":
      return batteryView(event);
  }
}

export function shouldPresentOsEvent(
  expanded: boolean,
  runActive: boolean,
  event: OsEventView | null,
): boolean {
  return event !== null && !expanded && !runActive;
}
