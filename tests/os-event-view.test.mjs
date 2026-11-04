import { describe, expect, test } from "bun:test";
import {
  presentOsEvent,
  shouldPresentOsEvent,
} from "../src/features/os-events/view-model.ts";

const base = { id: 1 };

describe("OS event presentation", () => {
  test("volume maps to a meter and clamps out-of-range levels", () => {
    const view = presentOsEvent({ ...base, class: "volume", percent: 68, muted: false });
    expect(view.label).toBe("Volume");
    expect(view.status).toBe("68%");
    expect(view.meter).toBe(true);
    expect(view.icon).toBe("volume");
    expect(presentOsEvent({ ...base, class: "volume", percent: 140, muted: false }).status).toBe(
      "100%",
    );
  });

  test("muted volume is a warning state without inventing a level", () => {
    const view = presentOsEvent({ ...base, class: "volume", percent: 40, muted: true });
    expect(view.status).toBe("Muted");
    expect(view.tone).toBe("warning");
  });

  test("brightness keeps a level and a meter", () => {
    const view = presentOsEvent({ ...base, class: "brightness", percent: 74 });
    expect(view.label).toBe("Brightness");
    expect(view.status).toBe("74%");
    expect(view.meter).toBe(true);
  });

  test("connectivity tone follows observed state only", () => {
    expect(presentOsEvent({ ...base, class: "wifi", connected: true })).toMatchObject({
      label: "Wi-Fi",
      status: "Connected",
      tone: "positive",
      meter: false,
    });
    expect(presentOsEvent({ ...base, class: "wifi", connected: false }).tone).toBe("warning");
  });

  test("audio peripherals use a device label and headphones identity", () => {
    expect(
      presentOsEvent({
        ...base,
        class: "bluetooth",
        connected: true,
        kind: "audio",
        name: "WH-1000XM5",
      }),
    ).toMatchObject({ label: "WH-1000XM5", status: "Connected", icon: "headphones" });
    expect(
      presentOsEvent({ ...base, class: "bluetooth", connected: false, kind: "input", name: null }),
    ).toMatchObject({ label: "Bluetooth device", status: "Disconnected", icon: "bluetooth" });
  });

  test("battery reports charging, low, critical and unknown percentage truthfully", () => {
    const charging = presentOsEvent({
      ...base,
      class: "battery",
      plugged: true,
      charging: true,
      percent: 82,
      low: false,
      critical: false,
    });
    expect(charging).toMatchObject({
      status: "Charging 82%",
      tone: "positive",
      icon: "batteryCharging",
    });
    const low = presentOsEvent({
      ...base,
      class: "battery",
      plugged: false,
      charging: false,
      percent: 15,
      low: true,
      critical: false,
    });
    expect(low).toMatchObject({ status: "Low 15%", tone: "warning", icon: "batteryLow" });
    const critical = presentOsEvent({
      ...base,
      class: "battery",
      plugged: false,
      charging: false,
      percent: 8,
      low: true,
      critical: true,
    });
    expect(critical).toMatchObject({ status: "Critical 8%", tone: "critical" });
    const unknown = presentOsEvent({
      ...base,
      class: "battery",
      plugged: false,
      charging: false,
      percent: null,
      low: false,
      critical: false,
    });
    expect(unknown.status).toBe("On battery");
    const plugged = presentOsEvent({
      ...base,
      class: "battery",
      plugged: true,
      charging: false,
      percent: 100,
      low: false,
      critical: false,
    });
    expect(plugged).toMatchObject({ status: "Plugged in 100%", tone: "positive" });
  });
});

describe("OS event presentation eligibility", () => {
  const event = { class: "wifi", id: 1, connected: true };

  test("only a compact shell without an active run presents an event", () => {
    expect(shouldPresentOsEvent(false, false, event)).toBe(true);
    expect(shouldPresentOsEvent(true, false, event)).toBe(false);
    expect(shouldPresentOsEvent(false, true, event)).toBe(false);
    expect(shouldPresentOsEvent(true, true, event)).toBe(false);
    expect(shouldPresentOsEvent(false, false, null)).toBe(false);
  });
});
