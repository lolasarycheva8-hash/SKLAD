import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDeliveries,
  useUpdateDelivery,
  updateDeliveriesActualBulk,
  getListDeliveriesQueryKey,
  getGetDeliveryDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  parseExcelFile,
  readSheetHeaders,
  validateTemplateHeaders,
  exportRowsToExcel,
} from "@/lib/excel-import";
import {
  buildDeliveryFactUpdates,
  deliveryFactExportRows,
  DELIVERY_FACT_HEADERS,
} from "@/lib/delivery-fact-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

const ALL_DRIVERS = "__all__";

function formatRuDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10).split("-").reverse().join(".");
}

function todayValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateInputValue(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export default function DeliveryRun() {
  const [, setLocation] = useLocation();
  const [date, setDate] = useState(todayValue());
  const [driver, setDriver] = useState<string>(ALL_DRIVERS);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit, isAdmin } = usePermissions();
  const canEditDeliveries = canEdit("deliveries");

  const { data: deliveries, isLoading } = useListDeliveries({ dateFrom: date, dateTo: date });

  const drivers = useMemo(() => {
    const set = new Set((deliveries ?? []).map((d) => d.driver).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [deliveries]);

  const rows = useMemo(() => {
    const filtered = (deliveries ?? []).filter(
      (d) => driver === ALL_DRIVERS || d.driver === driver,
    );
    return [...filtered].sort((a, b) => a.siteName.localeCompare(b.siteName, "ru"));
  }, [deliveries, driver]);

  const doneCount = rows.filter((d) => !!d.actualDate).length;

  const driverStats = useMemo(() => {
    if (driver !== ALL_DRIVERS) return [];
    const map = new Map<string, { done: number; total: number }>();
    for (const d of rows) {
      const key = d.driver || "Без водителя";
      const entry = map.get(key) ?? { done: 0, total: 0 };
      entry.total++;
      if (d.actualDate) entry.done++;
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [rows, driver]);

  const updateDelivery = useUpdateDelivery({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDeliveryDashboardSummaryQueryKey() });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  function handleToggle(id: string, checked: boolean) {
    updateDelivery.mutate({
      id,
      data: { actualDate: checked ? todayValue() : null },
    });
  }

  function handleDateChange(id: string, value: string) {
    updateDelivery.mutate({
      id,
      data: { actualDate: value || null },
    });
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  function handleExportPlan() {
    exportRowsToExcel(
      deliveryFactExportRows(rows),
      DELIVERY_FACT_HEADERS,
      `план-развоза-${date}.xlsx`,
    );
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isAdmin) {
      toast({
        title: "Недостаточно прав",
        description: "Загрузка факта доступна только суперадминистратору.",
        variant: "destructive",
      });
      return;
    }

    try {
      const headers = await readSheetHeaders(file);
      const missing = validateTemplateHeaders(headers, DELIVERY_FACT_HEADERS);
      if (missing.length > 0) {
        toast({
          title: "Неверный формат файла",
          description: `Не хватает колонок: ${missing.join(", ")}. Выгрузите план и заполните колонку «Дата факта».`,
          variant: "destructive",
        });
        return;
      }

      const fileRows = await parseExcelFile(file);
      const { updates, unmatched } = buildDeliveryFactUpdates(
        fileRows,
        deliveries ?? [],
        date,
      );

      if (updates.length === 0) {
        toast({
          title: "Нет изменений",
          description:
            unmatched.length > 0
              ? `Совпадений не найдено для: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? "…" : ""}`
              : "В файле нет новых отметок «Дата факта».",
        });
        return;
      }

      setImporting(true);
      const result = await updateDeliveriesActualBulk({ items: updates });
      queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDeliveryDashboardSummaryQueryKey() });

      const parts = [`Проставлено как выполнено: ${result.updated}`];
      if (unmatched.length > 0) parts.push(`не найдено объектов: ${unmatched.length}`);
      toast({
        title: "Загрузка факта завершена",
        description: parts.join(", "),
      });
    } catch (err) {
      toast({
        title: "Ошибка чтения файла",
        description: err instanceof Error ? err.message : "Не удалось прочитать файл",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          onClick={() => setLocation("/deliveries")}
          data-testid="button-back-deliveries"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Назад к графику доставок
        </Button>
        <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full mt-2" data-testid="text-page-title">
          Развоз за день
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Выберите дату и водителя, отметьте выполненные доставки — дата факта проставится
          автоматически (день отметки), при необходимости её можно исправить вручную.
        </p>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-2">
          <Label htmlFor="run-date">Плановая дата</Label>
          <Input
            id="run-date"
            type="date"
            className="w-44"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setDriver(ALL_DRIVERS);
            }}
            data-testid="input-run-date"
          />
        </div>
        <div className="space-y-2">
          <Label>Водитель</Label>
          <Select value={driver} onValueChange={setDriver}>
            <SelectTrigger className="w-64" data-testid="select-run-driver">
              <SelectValue placeholder="Все водители" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DRIVERS}>Все водители</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="secondary" className="mb-2" data-testid="badge-run-progress">
          Выполнено: {doneCount} из {rows.length}
        </Badge>
        <div className="flex items-center gap-2 mb-0.5 ml-auto">
          <Button
            variant="outline"
            onClick={handleExportPlan}
            disabled={rows.length === 0}
            data-testid="button-export-run-plan"
          >
            <Download className="h-4 w-4 mr-2" />
            Выгрузить план
          </Button>
          {isAdmin && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportFile}
                data-testid="input-import-run-fact"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                data-testid="button-import-run-fact"
              >
                <Upload className="h-4 w-4 mr-2" />
                {importing ? "Загрузка..." : "Загрузить факт"}
              </Button>
            </>
          )}
        </div>
      </div>

      {driver === ALL_DRIVERS && driverStats.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="driver-summary">
          {driverStats.map((s) => (
            <Badge
              key={s.name}
              variant={s.done === s.total ? "default" : "outline"}
              data-testid={`badge-driver-progress-${s.name}`}
            >
              {s.name}: {s.done} из {s.total}
            </Badge>
          ))}
        </div>
      )}

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Факт</TableHead>
              <TableHead>Объект</TableHead>
              <TableHead>Водитель</TableHead>
              <TableHead>План</TableHead>
              <TableHead className="w-44">Дата факта</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length > 0 ? (
              rows.map((delivery) => (
                <TableRow key={delivery.id} data-testid={`row-run-${delivery.id}`}>
                  <TableCell>
                    <Checkbox
                      checked={!!delivery.actualDate}
                      disabled={!canEditDeliveries || updateDelivery.isPending}
                      onCheckedChange={(checked) => handleToggle(delivery.id, checked === true)}
                      data-testid={`checkbox-run-${delivery.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{delivery.siteName}</TableCell>
                  <TableCell>{delivery.driver}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRuDate(delivery.plannedDate)}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      className="h-8 w-40"
                      disabled={!canEditDeliveries}
                      value={delivery.actualDate ? toDateInputValue(delivery.actualDate) : ""}
                      onChange={(e) => handleDateChange(delivery.id, e.target.value)}
                      data-testid={`input-run-actual-date-${delivery.id}`}
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  На выбранную дату доставок нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
