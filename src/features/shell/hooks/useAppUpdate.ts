import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkAppUpdate,
  closeAppUpdate,
  installAppUpdate,
  type AppUpdate,
} from "../../../platform/updates";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import type { AppUpdateState, AppUpdateViewModel } from "../model/view-model";

export type { AppUpdateState } from "../model/view-model";

const checkInterval = 6 * 60 * 60 * 1000;

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>(() =>
    nativeAvailable ? { status: "checking" } : { status: "current" },
  );
  const update = useRef<AppUpdate | null>(null);
  const checking = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (!nativeAvailable || checking.current) return;
    checking.current = true;
    setState({ status: "checking" });
    try {
      const next = await checkAppUpdate();
      closeAppUpdate(update.current);
      update.current = next;
      setState(next ? { status: "available", version: next.version } : { status: "current" });
    } catch {
      setState({ status: "error" });
    } finally {
      checking.current = false;
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const pending = update.current;
    if (!pending) return;
    setState({ status: "installing", version: pending.version });
    try {
      await installAppUpdate(pending);
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void checkForUpdate();
    const interval = window.setInterval(() => void checkForUpdate(), checkInterval);
    return () => {
      window.clearInterval(interval);
      closeAppUpdate(update.current);
      update.current = null;
    };
  }, [checkForUpdate]);

  return { state, checkForUpdate, installUpdate } satisfies AppUpdateViewModel;
}
