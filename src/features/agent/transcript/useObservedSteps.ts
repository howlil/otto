import { useEffect, useState } from "react";

export function useObservedSteps(current: string | null): string[] {
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    setSeen((previous) => {
      if (current === null) return previous.length ? [] : previous;
      return previous.includes(current) ? previous : [...previous, current];
    });
  }, [current]);
  return current === null ? [] : seen.filter((label) => label !== current);
}
