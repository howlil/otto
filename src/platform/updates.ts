import { check, type Update } from "@tauri-apps/plugin-updater";

export type AppUpdate = Update;

export function checkAppUpdate(): Promise<Update | null> {
  return check({ timeout: 30_000 });
}

export function installAppUpdate(update: Update): Promise<void> {
  return update.downloadAndInstall(undefined, { restartAfterInstall: true });
}

export function closeAppUpdate(update: Update | null): void {
  if (update) void update.close().catch(() => {});
}
