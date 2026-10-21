import { useCallback, useState } from "react";

function readStoredValue(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

/** Boolean UI preference remembered in this browser only. */
export function useStoredToggle(key: string, fallback = false) {
  const [value, setValue] = useState(() => readStoredValue(key, fallback));

  const update = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        try {
          window.localStorage.setItem(key, String(resolved));
        } catch {
          // Storage can be unavailable in private browsing; keep the in-memory state.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update] as const;
}
