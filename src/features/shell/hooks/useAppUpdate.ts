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
const initialCheckDelay = 60_000;

export function useAppUpdate(checkNow = false) {
  const [state, setState] = useState<AppUpdateState>(() =>
    nativeAvailable ? { status: "checking" } : { status: "current" },
  );
  const update = useRef<AppUpdate | null>(null);
  const checking = useRef(false);
  const checkedOnce = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (!nativeAvailable || checking.current) return;
    checking.current = true;
    checkedOnce.current = true;
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
    if (checkNow && !checkedOnce.current) {
      void checkForUpdate();
    }
  }, [checkForUpdate, checkNow]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      if (!checkedOnce.current) void checkForUpdate();
    }, initialCheckDelay);
    const interval = window.setInterval(() => void checkForUpdate(), checkInterval);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      closeAppUpdate(update.current);
      update.current = null;
    };
  }, [checkForUpdate]);

  return { state, checkForUpdate, installUpdate } satisfies AppUpdateViewModel;
}
