import { useCallback, useState } from "react";
import type { SettingsFocus, SettingsTab } from "../model/preferences";

export function useSettingsNav(enter: () => void) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("assistant");
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const openSettings = useCallback(
    (tab?: SettingsTab, focus?: SettingsFocus) => {
      if (tab) setSettingsTab(tab);
      setSettingsFocus(focus ?? null);
      enter();
    },
    [enter],
  );
  return { settingsTab, setSettingsTab, settingsFocus, openSettings };
}
