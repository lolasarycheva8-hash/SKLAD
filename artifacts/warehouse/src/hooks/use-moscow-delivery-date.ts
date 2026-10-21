import { useEffect, useState } from "react";
import { formatMoscowDate } from "@/lib/moscow-date";

/** Null selection follows Moscow today; an explicit date remains fixed. */
export function useMoscowDeliveryDate() {
  const [today, setToday] = useState(() => formatMoscowDate());
  const [fixedDate, setFixedDate] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      const date = formatMoscowDate(now);
      setToday(date);
      const midnight = Date.parse(`${date}T00:00:00+03:00`) + 24 * 60 * 60 * 1000;
      timer = setTimeout(refresh, Math.max(1, midnight - now.getTime()));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function setSelectedDate(date: string) {
    const current = formatMoscowDate();
    setToday(current);
    setFixedDate(date === current ? null : date);
  }

  return { today, selectedDate: fixedDate ?? today, setSelectedDate };
}
