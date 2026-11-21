import type { PointerEvent, RefObject } from "react";
import type { PlacementStatus } from "../hooks/useShellPlacement";
import type { Page, Placement, Preferences, SettingsFocus, SettingsTab } from "./preferences";

export type AppUpdateState =
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string }
  | { status: "installing"; version: string }
  | { status: "error" };

export type AppUpdateViewModel = {
  state: AppUpdateState;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
};

export type ShellViewModel = {
  page: Page;
  setPage: (page: Page) => void;
  expanded: boolean;
  pinned: boolean;
  pin: () => void;
  eventMotion: string;
  setEventMotion: (motion: string) => void;
  reducedMotion: boolean;
  isAgent: boolean;
  compactButton: RefObject<HTMLButtonElement | null>;
  settingsButton: RefObject<HTMLButtonElement | null>;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  settingsFocus: SettingsFocus | null;
  openSettings: (tab?: SettingsTab, focus?: SettingsFocus) => void;
  collapse: () => void;
  dismiss: () => void;
  open: (page: Page, pin?: boolean) => void;
  back: () => void;
  clearTimers: () => void;
  handleEnter: (event: PointerEvent<HTMLElement>) => void;
  handleLeave: (event: PointerEvent<HTMLElement>) => void;
  handlePanelPointerDown: (event: PointerEvent<HTMLElement>) => void;
  handlePanelPointerMove: (event: PointerEvent<HTMLElement>) => void;
  handlePanelPointerUp: () => void;
  notePanelMove: () => void;
  isPanelDragging: () => boolean;
  handleEscape: (event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault">) => void;
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  setPlacementPreference: (placement: Placement) => void;
  setPanelPosition: (position: { x: number; y: number }) => void;
  positionReset: number;
  captureProtected: boolean | null;
  captureProtectionSupported: boolean;
  captureProtectionPending: boolean;
  captureProtectionError: string | null;
  setCaptureProtection: (enabled: boolean) => Promise<void>;
  quitSupported: boolean;
  quitOtto: () => Promise<void>;
  ottoOs: boolean;
  compactCircle: boolean;
  toggleCompactStyle: () => void;
  placement: PlacementStatus;
  syncPlacement: (placement: Placement) => void;
};
