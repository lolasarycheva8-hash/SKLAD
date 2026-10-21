import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info, Loader2, Search } from "lucide-react";
import type { DriverSummaryRow, DriverDayCounts } from "@/lib/driver-summary";

const indicators = [
  { key: "plan", label: "План", color: "text-black dark:text-slate-100" },
  { key: "done", label: "Выполнено", color: "text-orange-800 dark:text-orange-300" },
  { key: "closed", label: "Закрыто", color: "text-green-800 dark:text-green-300" },
  { key: "failed", label: "Не выполнено", color: "text-red-600 dark:text-red-400" },
] as const;

type DriverSummarySheetProps = {
  rows: DriverSummaryRow[];
  month: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
};

export function DriverSummarySheet({
  rows,
  month,
  isLoading,
  isError,
  onRetry,
}: DriverSummarySheetProps) {
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLocaleLowerCase("ru");
    return rows.filter((r) =>
      (r.driver || "Не назначен").toLocaleLowerCase("ru").includes(q)
    );
  }, [rows, search]);

  const daysInMonth = useMemo(() => {
    if (!month) return 31;
    const [year, monthNum] = month.split("-").map(Number);
    if (!year || !monthNum) return 31;
    return new Date(year, monthNum, 0).getDate();
  }, [month]);

  const dayLabels = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" data-testid="driver-summary-sheet">
      <div className="flex shrink-0 flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div className="w-full max-w-sm relative shrink-0">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Поиск водителя..."
             aria-label="Поиск водителя в сводке"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background h-8 text-xs"
          />
        </div>
        <div className="text-[11px] text-muted-foreground flex items-start gap-2 max-w-3xl bg-blue-50/50 dark:bg-blue-900/10 p-2 rounded border border-blue-100 dark:border-blue-900/30">
          <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="leading-tight">
            <strong className="text-foreground">Справка по датам:</strong> План и
            Не выполнено считаются по <em>исходной плановой</em> дате. Выполнено
            (ожидает утверждения акта) и Закрыто (акт утверждён) — по
            <em> фактической</em> дате. «Не выполнено» включает будущие планы,
            а не только просроченные. Сводка за весь месяц, без фильтров других листов.
            {" "}Итоги — сумма по дням месяца, проценты — от месячного плана водителя.
            Доставки без даты показаны отдельно; при нулевом плане процент не рассчитывается.
          </div>
        </div>
      </div>

      <div className="border rounded-md bg-background flex min-h-0 min-w-0 flex-1 flex-col shadow-sm">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground h-[400px]">
            <Loader2 className="h-6 w-6 animate-spin mb-2 text-primary" />
            <span className="text-sm">Загрузка сводки...</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center p-12 text-destructive h-[400px]">
            <AlertTriangle className="h-8 w-8 mb-2" />
            <span className="text-sm mb-4">Не удалось загрузить сводку.</span>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Повторить попытку
              </Button>
            )}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground h-[400px] text-sm">
            {rows.length === 0
              ? "Нет данных для отображения."
              : "Водители не найдены."}
          </div>
        ) : (
          <div
            className="overflow-auto relative flex-1 min-h-0"
            tabIndex={0}
            role="region"
            aria-label="Таблица сводки с горизонтальной прокруткой"
          >
            <table
              className="w-full min-w-[960px] table-fixed border-collapse text-left"
              aria-label="Сводка по водителям"
            >
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
                {dayLabels.map((day) => <col key={day} />)}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 left-0 z-30 bg-muted border-b border-r p-2 text-xs font-semibold text-foreground shadow-[1px_1px_0_0_var(--color-border)]">
                    Водитель
                  </th>
                  <th scope="col" className="sticky top-0 left-[120px] z-30 bg-muted border-b border-r px-2 py-2 text-xs font-semibold text-foreground">
                    Показатель
                  </th>
                  <th scope="col" className="sticky top-0 z-20 bg-muted border-b border-r px-2 py-2 text-xs font-semibold text-center">
                    Итого за месяц, шт
                  </th>
                  <th scope="col" className="sticky top-0 z-20 bg-muted border-b border-r px-2 py-2 text-xs font-semibold text-center">
                    Итого за месяц, %
                  </th>
                  {dayLabels.map((d) => (
                    <th
                      key={d}
                      scope="col"
                      aria-label={`${String(d).padStart(2, "0")}.${month.slice(5, 7)}.${month.slice(0, 4)}`}
                      className="sticky top-0 z-20 bg-muted border-b border-r py-2 text-[11px] font-semibold text-foreground text-center shadow-[0_1px_0_0_var(--color-border)]"
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.key}
                    data-testid={`driver-summary-row-${row.key}`}
                    className="group hover:bg-muted/30 transition-colors"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-background border-b border-r p-2 text-xs font-medium text-foreground break-words shadow-[1px_0_0_0_var(--color-border)]"
                      title={row.driver || "Не назначен"}
                    >
                      {row.driver || "Не назначен"}
                      {row.undated > 0 && (
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          Без даты: {row.undated}
                        </span>
                      )}
                    </th>
                    <td className="sticky left-[120px] z-10 border-b border-r bg-background px-2 py-1 align-top">
                      <div className="grid whitespace-nowrap text-[10px] font-medium leading-[18px]">
                        {indicators.map(({ key, label, color }) => (
                          <span key={key} className={color}>{label}</span>
                        ))}
                      </div>
                    </td>
                    <MonthTotalCells days={row.days.slice(0, daysInMonth)} />
                    {row.days.map((day, i) => (
                      <td key={i} className="border-b border-r py-1 align-top">
                        <DayCell counts={day} />
                      </td>
                    ))}
                    {Array.from({
                      length: Math.max(0, daysInMonth - row.days.length),
                    }).map((_, i) => (
                      <td key={`empty-${i}`} className="border-b border-r p-1" />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MonthTotalCells({ days }: { days: DriverDayCounts[] }) {
  const totals = days.reduce<DriverDayCounts>((sum, day) => ({
    plan: sum.plan + day.plan,
    done: sum.done + day.done,
    closed: sum.closed + day.closed,
    failed: sum.failed + day.failed,
  }), { plan: 0, done: 0, closed: 0, failed: 0 });
  return (
    <>
      <td className="border-b border-r bg-muted/30 py-1 align-top">
        <div className="grid text-center text-[11px] font-semibold tabular-nums leading-[18px]">
          {indicators.map(({ key, label, color }) => (
            <span key={key} className={color} aria-label={`${label} за месяц, шт: ${totals[key]}`}>{totals[key]}</span>
          ))}
        </div>
      </td>
      <td className="border-b border-r bg-muted/30 py-1 align-top">
        <div className="grid text-center text-[11px] font-semibold tabular-nums leading-[18px]">
          {indicators.map(({ key, label, color }) => {
            const percent = totals.plan > 0
              ? `${(totals[key] / totals.plan * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`
              : "—";
            return <span key={key} className={color} aria-label={`${label} за месяц, %: ${percent}`}>{percent}</span>;
          })}
        </div>
      </td>
    </>
  );
}

function DayCell({ counts }: { counts: DriverDayCounts }) {
  return (
    <div className="grid text-center text-[11px] font-medium tabular-nums leading-[18px]">
      {indicators.map(({ key, label, color }) => (
        <span
          key={key}
          className={color}
          title={`${label}: ${counts[key]}`}
          aria-label={`${label}: ${counts[key]}`}
        >
          {counts[key]}
        </span>
      ))}
    </div>
  );
}
