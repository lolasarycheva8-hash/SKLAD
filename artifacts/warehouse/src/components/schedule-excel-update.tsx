import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  reviewDeliverySchedule,
  type ScheduleReviewResult,
  type ScheduleReviewRow,
} from "@workspace/api-client-react";
import { FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { parseExcelFile, readSheetHeaders } from "@/lib/excel-import";
import {
  buildScheduleReviewRows,
  findScheduleHeaderProblems,
  type ScheduleReviewRowInput,
} from "@/lib/schedule-review-import";
import { invalidateDeliveryWorkspaceQueries } from "@/lib/delivery-query-invalidation";
import { formatMonthLabel } from "@/lib/delivery-workspace";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
type StatusFilter = "all" | ScheduleReviewRow["status"];

const STATUS_META: Record<ScheduleReviewRow["status"], { label: string; tone: string }> = {
  update: { label: "Изменение", tone: "bg-blue-100/70 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200" },
  create: { label: "Новая", tone: "bg-emerald-100/70 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200" },
  unchanged: { label: "Без изменений", tone: "bg-muted text-muted-foreground" },
  protected: { label: "Защищена", tone: "bg-amber-100/70 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" },
  conflict: { label: "Конфликт", tone: "bg-red-100/70 text-red-900 dark:bg-red-900/30 dark:text-red-200" },
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

function isStale(error: unknown): boolean {
  const e = error as { status?: number; response?: { status?: number } } | null;
  return e?.status === 409 || e?.response?.status === 409;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function defaultScheduleSelection(rows: ScheduleReviewRow[]): Set<number> {
  return new Set(rows.filter((r) => r.status === "update").map((r) => r.row));
}

export function ScheduleExcelUpdate({ month, disabled }: { month: string; disabled?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ScheduleReviewRowInput[] | null>(null);
  const [preview, setPreview] = useState<ScheduleReviewResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const reviewedMonth = useRef(month);
  const requestVersion = useRef(0);

  const reset = () => {
    requestVersion.current++;
    setLoading(false);
    setRows(null);
    setPreview(null);
    setSelected(new Set());
    setFilter("all");
    setPage(1);
    setError(null);
    setStaleNotice(false);
    setFileName("");
  };

  // Month changed: previous preview is no longer valid.
  useEffect(() => {
    if (reviewedMonth.current !== month) {
      reviewedMonth.current = month;
      if (!applying) {
        reset();
        setOpen(false);
      }
    }
  }, [month, applying]);

  async function runPreview(input: ScheduleReviewRowInput[], stale = false) {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setPreview(null);
    setSelected(new Set());
    try {
      const result = await reviewDeliverySchedule({ month, rows: input });
      if (version !== requestVersion.current) return;
      setPreview(result);
      setSelected(defaultScheduleSelection(result.rows));
      setPage(1);
      setStaleNotice(stale);
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(errorText(e));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    reset();
    const version = requestVersion.current;
    setFileName(file.name);
    setOpen(true);
    try {
      const missing = findScheduleHeaderProblems(await readSheetHeaders(file));
      if (version !== requestVersion.current) return;
      if (missing.length) {
        setError(`В файле нет колонок: ${missing.join(", ")}`);
        return;
      }
      const parsed = buildScheduleReviewRows(await parseExcelFile(file));
      if (version !== requestVersion.current) return;
      if (!parsed.length) {
        setError("В файле нет строк с данными");
        return;
      }
      if (parsed.length > 10000) {
        setError(`В файле ${parsed.length} строк — максимум 10 000 за одно обновление`);
        return;
      }
      setRows(parsed);
      await runPreview(parsed);
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(`Не удалось прочитать файл: ${errorText(e)}`);
    }
  }

  async function apply() {
    if (!rows || !preview || selected.size === 0) return;
    setApplying(true);
    setError(null);
    try {
      const result = await reviewDeliverySchedule({
        month,
        rows,
        fingerprint: preview.fingerprint,
        selectedRows: Array.from(selected).sort((a, b) => a - b),
      });
      invalidateDeliveryWorkspaceQueries(queryClient);
      toast({
        title: "График обновлён",
        description: `Изменено: ${result.updated}, создано: ${result.created}`,
      });
      setApplying(false);
      reset();
      setOpen(false);
    } catch (e) {
      setApplying(false);
      if (isStale(e)) {
        // Never resubmit silently: fetch a fresh preview and require a new review.
        await runPreview(rows, true);
      } else {
        setError(`Не удалось применить: ${errorText(e)}`);
      }
    }
  }

  const counts = useMemo(() => {
    const c = { update: 0, create: 0, unchanged: 0, protected: 0, conflict: 0 };
    preview?.rows.forEach((r) => (c[r.status] += 1));
    return c;
  }, [preview]);

  const visible = useMemo(
    () => (preview?.rows ?? []).filter((r) => filter === "all" || r.status === filter),
    [preview, filter],
  );
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const updateRows = preview?.rows.filter((r) => r.status === "update") ?? [];
  const createRows = preview?.rows.filter((r) => r.status === "create") ?? [];
  const selectedUpdates = updateRows.filter((r) => selected.has(r.row)).length;
  const selectedCreates = createRows.filter((r) => selected.has(r.row)).length;

  const setMany = (list: ScheduleReviewRow[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      list.forEach((r) => (on ? next.add(r.row) : next.delete(r.row)));
      return next;
    });

  const toggle = (row: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });

  const filterButtons: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "Все", count: preview?.rows.length ?? 0 },
    { id: "update", label: STATUS_META.update.label, count: counts.update },
    { id: "create", label: STATUS_META.create.label, count: counts.create },
    { id: "unchanged", label: STATUS_META.unchanged.label, count: counts.unchanged },
    { id: "protected", label: STATUS_META.protected.label, count: counts.protected },
    { id: "conflict", label: STATUS_META.conflict.label, count: counts.conflict },
  ];

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={handleFile}
        data-testid="input-schedule-excel-update"
      />
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        disabled={disabled || loading || applying}
        onClick={() => inputRef.current?.click()}
        data-testid="button-schedule-excel-update"
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        Обновить из Excel
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (applying) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent
          className="max-w-5xl w-[calc(100vw-1rem)] max-h-[92dvh] flex flex-col gap-3 p-4 sm:p-6"
          onInteractOutside={(e) => applying && e.preventDefault()}
          onEscapeKeyDown={(e) => applying && e.preventDefault()}
          data-testid="dialog-schedule-excel-update"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Обновление графика за {formatMonthLabel(month)}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {fileName && <span className="font-medium text-foreground">{fileName}. </span>}
              Из файла читаются только колонки «Объект» (или «Магазин»), «Водитель» и «Плановая дата».
              Колонка «Факт.дата» и все остальные игнорируются: фактические даты, акты, согласования и
              комментарии не меняются. Доставки, которых нет в файле, остаются без изменений.
              Выполненные и закрытые доставки защищены, конфликты не применяются.
            </DialogDescription>
          </DialogHeader>

          {staleNotice && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" data-testid="status-schedule-stale">
              График изменился, пока вы смотрели предпросмотр. Ниже — новый расчёт; проверьте выбор и
              примените ещё раз.
            </div>
          )}
          {error && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-schedule-error">
              <span className="flex-1">{error}</span>
              {rows && !applying && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => runPreview(rows)} data-testid="button-schedule-retry">
                  Повторить
                </Button>
              )}
            </div>
          )}

          {loading && (
            <div className="space-y-2" data-testid="status-schedule-loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}

          {preview && !loading && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {filterButtons.map((f) => (
                  <Button
                    key={f.id}
                    size="sm"
                    variant={filter === f.id ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setFilter(f.id);
                      setPage(1);
                    }}
                    data-testid={`filter-schedule-${f.id}`}
                  >
                    {f.label}
                    <span className="ml-1 tabular-nums opacity-70">{f.count}</span>
                  </Button>
                ))}
              </div>

              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={applying || updateRows.length === 0}
                    checked={updateRows.length > 0 && selectedUpdates === updateRows.length}
                    onChange={(e) => setMany(updateRows, e.target.checked)}
                    data-testid="checkbox-schedule-select-updates"
                  />
                  Изменения: выбрано {selectedUpdates} из {updateRows.length}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={applying || createRows.length === 0}
                    checked={createRows.length > 0 && selectedCreates === createRows.length}
                    onChange={(e) => setMany(createRows, e.target.checked)}
                    data-testid="checkbox-schedule-select-new"
                  />
                  Создать новые доставки: {selectedCreates} из {createRows.length}
                  <span className="text-muted-foreground">(по умолчанию не выбраны)</span>
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                {pageRows.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">Нет строк в этой категории</div>
                ) : (
                  <ul className="divide-y">
                    {pageRows.map((r) => {
                      const selectable = r.status === "update" || r.status === "create";
                      const meta = STATUS_META[r.status];
                      const dateChanged = r.oldDate !== r.newDate;
                      const driverChanged = r.oldDriver !== r.newDriver;
                      return (
                        <li
                          key={r.row}
                          className={cn("flex gap-2 px-2 py-2 text-xs", !selectable && "opacity-80")}
                          data-testid={`row-schedule-${r.row}`}
                        >
                          <div className="w-5 pt-0.5">
                            {selectable && (
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                disabled={applying}
                                checked={selected.has(r.row)}
                                onChange={() => toggle(r.row)}
                                aria-label={`Выбрать строку ${r.row}`}
                                data-testid={`checkbox-schedule-row-${r.row}`}
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="tabular-nums text-muted-foreground">стр. {r.row}</span>
                              <span className="font-medium">{r.siteName || "—"}</span>
                              <Badge variant="outline" className={cn("border-0 text-[10px]", meta.tone)}>
                                {meta.label}
                              </Badge>
                            </div>
                            <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                              <span>
                                Дата: <span className={cn(dateChanged && "line-through text-muted-foreground")}>{fmtDate(r.oldDate)}</span>
                                {dateChanged && <> → <b>{fmtDate(r.newDate)}</b></>}
                              </span>
                              <span>
                                Водитель: <span className={cn(driverChanged && "line-through text-muted-foreground")}>{r.oldDriver || "—"}</span>
                                {driverChanged && <> → <b>{r.newDriver || "—"}</b></>}
                              </span>
                            </div>
                            {r.reason && <div className="text-muted-foreground">{r.reason}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {visible.length > PAGE_SIZE && (
                <div className="flex items-center justify-end gap-2 text-xs">
                  <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="button-schedule-prev">
                    Назад
                  </Button>
                  <span className="tabular-nums">{page} / {totalPages}</span>
                  <Button size="sm" variant="outline" className="h-7" disabled={page >= totalPages} onClick={() => setPage(page + 1)} data-testid="button-schedule-next">
                    Далее
                  </Button>
                </div>
              )}
            </>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              disabled={applying}
              onClick={() => {
                setOpen(false);
                reset();
              }}
              data-testid="button-schedule-cancel"
            >
              Отмена
            </Button>
            <Button
              disabled={!preview || loading || applying || selected.size === 0}
              onClick={apply}
              data-testid="button-schedule-apply"
            >
              {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Применить {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
