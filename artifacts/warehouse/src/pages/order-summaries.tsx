import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrderSummaries,
  useListOrderClientLookup,
  usePreviewOrderSummary,
  useCreateOrderSummary,
  getListOrderSummariesQueryKey,
  getListOrdersQueryKey,
  type OrderSummaryPreview,
  type OrderSummaryBlocker,
  type ListOrderSummariesStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import {
  ORDER_STATUS_LABELS,
  SUMMARY_STATUS_LABELS,
  apiErrorBlockers,
  apiErrorMessage,
  formatPeriod,
} from "@/lib/order-status";

const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const validMonth = (v: string) => /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(v);

function BlockerList({ blockers }: { blockers: OrderSummaryBlocker[] }) {
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 space-y-2" data-testid="summary-blockers">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" />
        Итоговый заказ создать нельзя: в периоде есть заказы, которые ещё не доставлены
      </div>
      <ul className="space-y-1">
        {blockers.map((b) => (
          <li key={b.id} className="flex flex-wrap gap-2">
            <Link href={`/orders/${b.id}`} className="font-medium underline">№{b.number}</Link>
            <span>— {ORDER_STATUS_LABELS[b.status] ?? b.status}</span>
            {b.reason && <span className="text-red-700">({b.reason})</span>}
          </li>
        ))}
      </ul>
      <div>Сначала завершите эти заказы (доставка выполнена и акт загружен), затем повторите формирование.</div>
    </div>
  );
}

export default function OrderSummaries() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditOrders = canEdit("orders");

  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ListOrderSummariesStatus>("");
  const params = useMemo(() => {
    const p: { clientId?: string; status?: ListOrderSummariesStatus } = {};
    if (clientFilter) p.clientId = clientFilter;
    if (statusFilter) p.status = statusFilter;
    return Object.keys(p).length ? p : undefined;
  }, [clientFilter, statusFilter]);
  const { data: summaries, isLoading, isError, refetch } = useListOrderSummaries(params);
  const { data: clients } = useListOrderClientLookup();

  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [preview, setPreview] = useState<{ key: string; data: OrderSummaryPreview } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [createBlockers, setCreateBlockers] = useState<OrderSummaryBlocker[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);

  const key = `${clientId}|${periodFrom}|${periodTo}`;
  const inputsValid = !!clientId && validMonth(periodFrom) && validMonth(periodTo) && periodFrom <= periodTo;
  const currentPreview = preview && preview.key === key ? preview.data : null;

  function resetDerived() {
    setPreview(null);
    setPreviewError(null);
    setCreateBlockers([]);
    setCreateError(null);
  }

  const previewMutation = usePreviewOrderSummary();
  const createMutation = useCreateOrderSummary();

  function openDialog() {
    setClientId(clientFilter);
    setPeriodFrom("");
    setPeriodTo("");
    resetDerived();
    requestRef.current = null;
    setOpen(true);
  }

  function runPreview() {
    if (!inputsValid) return;
    const k = key;
    setPreviewError(null);
    setCreateBlockers([]);
    setCreateError(null);
    previewMutation.mutate(
      { data: { clientId, periodFrom, periodTo } },
      {
        onSuccess: (data) => setPreview({ key: k, data }),
        onError: (e) => setPreviewError(apiErrorMessage(e)),
      },
    );
  }

  function runCreate() {
    if (!currentPreview || currentPreview.blockers.length > 0 || currentPreview.orders.length === 0) return;
    // Retain the same requestId across retries of the same create attempt.
    if (!requestRef.current || requestRef.current.key !== key) {
      requestRef.current = { key, id: crypto.randomUUID() };
    }
    setCreateError(null);
    setCreateBlockers([]);
    createMutation.mutate(
      { data: { clientId, periodFrom, periodTo, requestId: requestRef.current.id } },
      {
        onSuccess: (summary) => {
          requestRef.current = null;
          queryClient.invalidateQueries({ queryKey: getListOrderSummariesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/orders/") });
          setOpen(false);
          toast({ title: `Итоговый заказ №${summary.number} сформирован` });
          navigate(`/order-summaries/${summary.id}`);
        },
        onError: (e) => {
          const blockers = apiErrorBlockers(e);
          if (blockers.length) {
            setCreateBlockers(blockers);
            setPreview(null);
            requestRef.current = null;
          }
          setCreateError(apiErrorMessage(e));
        },
      },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0 space-y-4">
        <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full" data-testid="text-page-title">
          Итоговые заказы
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href="/orders">
              <Button variant="ghost" size="icon" data-testid="button-back-to-orders"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <p className="text-muted-foreground text-sm">
              Сводные документы для выставления клиенту за период. Не являются отдельными заказами для отгрузки.
            </p>
          </div>
          {canEditOrders && (
            <Button onClick={openDialog} data-testid="button-create-summary">
              <Plus className="h-4 w-4 mr-2" />
              Итоговый заказ
            </Button>
          )}
        </div>
        <div role="tablist" aria-label="Разделы заказов" className="flex flex-wrap border-b">
          {[
            { value: "work", label: "Заказы в работе" },
            { value: "awaiting", label: "Ожидают оплаты" },
            { value: "paid", label: "Оплачено" },
          ].map((tab) => (
            <Link key={tab.value} href={`/orders?tab=${tab.value}`} role="tab" aria-selected={false}
              className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {tab.label}
            </Link>
          ))}
          <span role="tab" aria-selected={true}
            className="-mb-px border-b-2 border-blue-900 px-4 py-2 text-sm font-medium text-blue-900"
            data-testid="tab-orders-summaries">
            Итоговые заказы
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-4 rounded-md border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label htmlFor="summary-client-filter" className="text-xs">Клиент</Label>
            <select id="summary-client-filter" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
              className="h-10 w-64 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-summary-client-filter">
              <option value="">Все клиенты</option>
              {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="summary-status-filter" className="text-xs">Статус оплаты</Label>
            <select id="summary-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-summary-status-filter">
              <option value="">Все</option>
              <option value="awaiting_payment">Ожидает оплаты</option>
              <option value="paid">Оплачен</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
        <Table className="text-xs" containerClassName="h-full overflow-auto">
          <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
            <TableRow>
              <TableHead>Номер</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Период</TableHead>
              <TableHead>Заказов</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead>Оплата</TableHead>
              <TableHead>Создан</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [0, 1, 2].map((i) => (
                <TableRow key={i}><TableCell colSpan={8}><div className="h-4 w-full animate-pulse rounded bg-muted" /></TableCell></TableRow>
              ))
            ) : isError ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center">
                <div className="text-destructive mb-2">Не удалось загрузить итоговые заказы</div>
                <Button variant="outline" size="sm" onClick={() => refetch()}>Повторить</Button>
              </TableCell></TableRow>
            ) : (summaries ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                Итоговых заказов нет. Сформируйте итоговый заказ по доставленным заказам клиента за период.
              </TableCell></TableRow>
            ) : (
              summaries!.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onDoubleClick={() => navigate(`/order-summaries/${s.id}`)} data-testid={`row-summary-${s.id}`}>
                  <TableCell className="py-1.5 font-medium">№{s.number}</TableCell>
                  <TableCell className="py-1.5">{s.clientName}</TableCell>
                  <TableCell className="py-1.5 whitespace-nowrap">{formatPeriod(s.periodFrom, s.periodTo)}</TableCell>
                  <TableCell className="py-1.5">{s.orders.length}</TableCell>
                  <TableCell className="py-1.5 text-right">{currency.format(s.totalAmount)}</TableCell>
                  <TableCell className="py-1.5">
                    <Badge variant="outline" className={s.status === "paid" ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"}>
                      {SUMMARY_STATUS_LABELS[s.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-1.5 text-muted-foreground">{dateFormatter.format(new Date(s.createdAt))}</TableCell>
                  <TableCell className="py-1.5">
                    <Link href={`/order-summaries/${s.id}`}>
                      <Button variant="outline" size="sm" data-testid={`button-open-summary-${s.id}`}>Открыть</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Новый итоговый заказ</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              В итоговый заказ попадают только доставленные заказы (доставка выполнена и акт загружен) за выбранные месяцы плана включительно.
              Если в периоде есть хотя бы один недоставленный заказ, формирование блокируется целиком.
            </div>
            <div className="space-y-2">
              <Label htmlFor="summary-client">Клиент *</Label>
              <select id="summary-client" value={clientId} onChange={(e) => { setClientId(e.target.value); resetDerived(); }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-summary-client">
                <option value="">Выберите клиента</option>
                {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="summary-from">Месяц плана с *</Label>
                <Input id="summary-from" type="month" value={periodFrom} onChange={(e) => { setPeriodFrom(e.target.value); resetDerived(); }} data-testid="input-summary-from" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="summary-to">по *</Label>
                <Input id="summary-to" type="month" value={periodTo} onChange={(e) => { setPeriodTo(e.target.value); resetDerived(); }} data-testid="input-summary-to" />
              </div>
            </div>
            {periodFrom && periodTo && periodFrom > periodTo && (
              <p className="text-sm text-destructive">Начало периода не может быть позже окончания</p>
            )}
            <Button variant="outline" onClick={runPreview} disabled={!inputsValid || previewMutation.isPending} data-testid="button-summary-preview">
              {previewMutation.isPending ? "Проверка..." : "Проверить и показать состав"}
            </Button>

            {previewError && (
              <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                Не удалось получить предпросмотр: {previewError}
                <Button variant="outline" size="sm" className="ml-2" onClick={runPreview}>Повторить</Button>
              </div>
            )}
            {createBlockers.length > 0 && <BlockerList blockers={createBlockers} />}
            {currentPreview && currentPreview.blockers.length > 0 && <BlockerList blockers={currentPreview.blockers} />}
            {currentPreview && currentPreview.blockers.length === 0 && currentPreview.orders.length === 0 && (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">За выбранный период у клиента нет доставленных заказов.</div>
            )}
            {currentPreview && currentPreview.blockers.length === 0 && currentPreview.orders.length > 0 && (
              <div className="space-y-2" data-testid="summary-preview">
                <div className="text-sm">
                  Заказы ({currentPreview.orders.length}): {currentPreview.orders.map((o) => `№${o.number}`).join(", ")}
                </div>
                <div className="border rounded-md overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader><TableRow>
                      <TableHead>Товар</TableHead><TableHead className="text-right">Кол-во</TableHead>
                      <TableHead className="text-right">Цена</TableHead><TableHead className="text-right">Сумма</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {currentPreview.items.map((it) => (
                        <TableRow key={`${it.productId}-${it.price}`}>
                          <TableCell className="py-1.5">{it.productName}</TableCell>
                          <TableCell className="py-1.5 text-right">{it.quantity} {it.unit}</TableCell>
                          <TableCell className="py-1.5 text-right">{currency.format(it.price)}</TableCell>
                          <TableCell className="py-1.5 text-right">{currency.format(it.total)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={3} className="py-1.5 text-right font-medium">Итого</TableCell>
                        <TableCell className="py-1.5 text-right font-medium">{currency.format(currentPreview.totalAmount)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            {createError && createBlockers.length === 0 && (
              <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                Не удалось сформировать: {createError}. Повторная попытка использует тот же идентификатор запроса.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={runCreate}
              disabled={!currentPreview || currentPreview.blockers.length > 0 || currentPreview.orders.length === 0 || createMutation.isPending}
              data-testid="button-summary-create">
              {createMutation.isPending ? "Формирование..." : createError ? "Повторить формирование" : "Сформировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
