import { useEffect, useState } from "react";
import { nativeAvailable, setOsEventsEnabled } from "../../platform/tauri/os-events";

export function useOsEventPreference(enabled: boolean) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    void setOsEventsEnabled(enabled)
      .then(() => {
        if (active) setError(null);
      })
      .catch(() => {
        if (active) setError("OS events could not be applied in this Windows session.");
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return error;
}
