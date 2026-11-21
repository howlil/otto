import { useCallback, useEffect, useState } from "react";
import {
  nativeAvailable,
  onVoiceLevelChanged,
  onVoiceStateChanged,
  onVoiceToggle,
  voiceListDevices,
  voiceShortcut,
  voiceStatus,
  type VoiceInputDevice,
  type VoiceSnapshot,
} from "../../platform/tauri";
import { DEFAULT_VOICE_SHORTCUT } from "./preferences";

export function useVoiceEvents({
  acceptSnapshot,
  setLevel,
  toggleRef,
}: {
  acceptSnapshot: (next: VoiceSnapshot) => void;
  setLevel: (level: number) => void;
  toggleRef: { current: () => Promise<void> };
}) {
  const [devices, setDevices] = useState<VoiceInputDevice[]>([
    { id: "default", name: "System default microphone", isDefault: true },
  ]);
  const [shortcut, setShortcut] = useState(DEFAULT_VOICE_SHORTCUT);
  const [shortcutMessage, setShortcutMessage] = useState("");
  const [shortcutBusy, setShortcutBusy] = useState(false);

  const refreshDevices = useCallback(async () => {
    if (!nativeAvailable) return;
    try {
      const list = await voiceListDevices();
      if (Array.isArray(list) && list.length > 0) setDevices(list);
    } catch {}
  }, []);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    void voiceStatus()
      .then((snap) => {
        if (active) acceptSnapshot(snap);
      })
      .catch(() => {});
    void refreshDevices();
    void voiceShortcut()
      .then((saved) => {
        if (!active) return;
        const next = typeof saved === "string" ? saved : "";
        setShortcut(next);
        if (!next) setShortcutMessage("Voice shortcut unavailable. Choose another combination.");
      })
      .catch((error: unknown) => {
        if (active) setShortcutMessage(String(error));
      });
    return () => {
      active = false;
    };
  }, [acceptSnapshot, refreshDevices]);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    let unlistenState: (() => void) | undefined;
    let unlistenLevel: (() => void) | undefined;
    let unlistenToggle: (() => void) | undefined;
    void onVoiceStateChanged((next) => {
      if (active) acceptSnapshot(next);
    }).then((stop) => {
      if (active) unlistenState = stop;
      else stop();
    });
    void onVoiceLevelChanged((nextLevel) => {
      if (active) setLevel(nextLevel);
    }).then((stop) => {
      if (active) unlistenLevel = stop;
      else stop();
    });
    void onVoiceToggle(() => {
      if (active) void toggleRef.current();
    }).then((stop) => {
      if (active) unlistenToggle = stop;
      else stop();
    });
    return () => {
      active = false;
      unlistenState?.();
      unlistenLevel?.();
      unlistenToggle?.();
    };
  }, [acceptSnapshot, setLevel, toggleRef]);

  const saveShortcut = useCallback(
    async (next?: string) => {
      if (!nativeAvailable || shortcutBusy) return;
      setShortcutBusy(true);
      setShortcutMessage("");
      try {
        const saved = await voiceShortcut(next ?? shortcut);
        setShortcut(typeof saved === "string" ? saved : "");
      } catch (error) {
        setShortcutMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setShortcutBusy(false);
      }
    },
    [shortcut, shortcutBusy],
  );

  return {
    devices,
    refreshDevices,
    shortcut,
    shortcutMessage,
    shortcutBusy,
    saveShortcut,
  };
}
