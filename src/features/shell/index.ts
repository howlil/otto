export { GlobalSettings } from "./GlobalSettings";
export { useAppUpdate, type AppUpdateState } from "./useAppUpdate";
export { useNotchShell, type PlacementStatus } from "./useNotchShell";
export {
  defaults,
  readPreferences,
  type Expression,
  type Motion,
  type Page,
  type Placement,
  type Preferences,
  type SettingsTab,
} from "./preferences";
export { resolveSurface } from "./surface";
export { notchGutter, notchShape, SHOULDER_PX, type NotchShape } from "./placement";
export {
  cappedMorphDuration,
  isContentResize,
  morphDuration,
  morphMilliseconds,
  shouldAnimateNotch,
  updateMeasuredHeights,
  type NotchGeometry,
} from "./motion";
export { ShellFrame } from "./ShellFrame";
export { useNotchSurfaceSync, type SurfaceSize } from "./useNotchSurfaceSync";
export { SurfaceError } from "./SurfaceError";
export type { RecoveryFrame } from "./surface-sync/useRenderedRegion";
