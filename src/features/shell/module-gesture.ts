import type { Page } from "./preferences";

const modules = ["agent", "music", "focus"] as const;

export function adjacentModule(page: Page, direction: number): Page | null {
  if (page.endsWith("settings")) return null;
  const index = (modules as readonly string[]).indexOf(page);
  if (index < 0) return direction > 0 ? "agent" : "focus";
  return modules[(index + direction + modules.length) % modules.length];
}

export class ModuleGesture {
  private x = 0;
  private y = 0;
  private last = -Infinity;
  private locked = false;
  private lockedAt = -Infinity;
  private direction = 0;
  private peak = 0;
  private previousMagnitude = 0;
  private decayed = false;

  reset() {
    this.x = 0;
    this.y = 0;
    this.last = -Infinity;
    this.locked = false;
    this.lockedAt = -Infinity;
    this.direction = 0;
    this.peak = 0;
    this.previousMagnitude = 0;
    this.decayed = false;
  }

  private renews(x: number, y: number, magnitude: number, now: number): boolean {
    if (now - this.lockedAt < 80) return false;
    const reversed =
      this.direction !== 0 &&
      Math.sign(x) !== this.direction &&
      Math.abs(x) >= 12 &&
      Math.abs(x) > Math.abs(y) * 1.4;
    return (
      reversed || (this.decayed && magnitude >= 12 && magnitude >= this.previousMagnitude * 2.5)
    );
  }

  feed(x: number, y: number, mode: number, now: number): number | null {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(now)) return null;
    const factor = mode === 1 ? 16 : mode === 2 ? 400 : 1;
    x *= factor;
    y *= factor;
    const magnitude = Math.max(Math.abs(x), Math.abs(y));
    if (now - this.last > 160 || (this.locked && this.renews(x, y, magnitude, now))) this.reset();
    this.last = now;
    this.peak = Math.max(this.peak, magnitude);
    this.previousMagnitude = magnitude;
    if (this.locked) {
      if (magnitude <= Math.max(4, this.peak * 0.25)) this.decayed = true;
      return null;
    }
    this.x += x;
    this.y += y;
    if (Math.abs(this.y) > 12 && Math.abs(this.y) >= Math.abs(this.x)) {
      this.locked = true;
      this.lockedAt = now;
      return null;
    }
    if (Math.abs(this.x) < 48 || Math.abs(this.x) < Math.abs(this.y) * 1.4) return null;
    this.locked = true;
    this.lockedAt = now;
    this.direction = Math.sign(this.x);
    return this.direction;
  }
}

export function ownsHorizontalInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], pre, table, [role="slider"], [role="dialog"], [data-module-gesture="off"]',
    ),
  );
}
