export { BehaviorSettings } from "./ui/settings/BehaviorSettings";
export { GeneralSettings } from "./ui/settings/GeneralSettings";
export { PositionSettings } from "./ui/settings/PositionSettings";
export { useAppUpdate, type AppUpdateState } from "./hooks/useAppUpdate";
export { useNotchShell, type PlacementStatus } from "./hooks/useNotchShell";
export type { AppUpdateViewModel, ShellViewModel } from "./model/view-model";
export {
  defaults,
  readPreferences,
  type Motion,
  type PanelPosition,
  type Page,
  type Placement,
  type Preferences,
  type SettingsFocus,
  type SettingsTab,
} from "./model/preferences";
export { resolveSurface } from "./model/surface";
export { notchGutter, notchShape, SHOULDER_PX, type NotchShape } from "./model/placement";
export {
  cappedMorphDuration,
  isContentResize,
  morphDuration,
  morphMilliseconds,
  shouldAnimateNotch,
  updateMeasuredHeights,
  type NotchGeometry,
} from "./model/motion";
export { ShellFrame } from "./ui/ShellFrame";
export { useNotchSurfaceSync, type SurfaceSize } from "./surface-sync/useNotchSurfaceSync";
export { SurfaceError } from "./ui/SurfaceError";
export type { RecoveryFrame } from "./surface-sync/useRenderedRegion";
