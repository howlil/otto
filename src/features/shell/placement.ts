import type { Placement } from "./preferences";

export type NotchShape = "capsule" | "card" | "attached";

export const SHOULDER_PX = 12;

export function notchShape(placement: Placement, expanded: boolean): NotchShape {
  if (placement === "attached") return "attached";
  return expanded ? "card" : "capsule";
}

export function notchGutter(shape: NotchShape): number {
  return shape === "attached" ? SHOULDER_PX : 0;
}
