import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  listOrders,
  useCreateOrder,
  useListOrderClientLookup,
  useListOrderProductLookup,
  useListOrderSiteLookup,
  getListOrdersQueryKey,
  getListDeliveriesQueryKey,
  getGetDeliveryDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  SortableHeader,
  type SortDirection,
} from "@/components/sortable-header";
import {
  Plus,
  Printer,
  Search,
  X,
  FileStack,
  Truck,
  Copy,
  Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import {
  EMPTY_ORDER_FORM_ITEM,
  OrderFormFields,
  copiedOrderSiteSelection,
  siteSelectionAfterClientChange,
  orderSiteIdForRequest,
  type OrderFormItem,
} from "@/components/order-form-fields";
import { downloadOrdersWorkbook } from "@/lib/orders-export";
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  isOrderBilled,
  orderMatchesTab,
  type OrderTab,
} from "@/lib/order-status";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

type ItemRow = OrderFormItem;

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

type SortField =
  | "clientName"
  | "itemsCount"
  | "totalAmount"
  | "status"
  | "createdAt";
type PaidFilter = "all" | "awaiting_payment" | "paid" | "unbilled";
const ORDER_TABS: { value: OrderTab; label: string }[] = [
  { value: "work", label: "Заказы в работе" },
  { value: "awaiting", label: "Ожидают оплаты" },
  { value: "paid", label: "Оплачено" },
];
const validMonth = (value: string) => /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
function moscowCurrentMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

export default function Orders() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [note, setNote] = useState("");
  const [plannedMonth, setPlannedMonth] = useState("");
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState("");
  const [monthFilter, setMonthFilter] = useState<"all" | "without" | "month">("all");
  const [selectedMonth, setSelectedMonth] = useState(moscowCurrentMonth);
  const [items, setItems] = useState<ItemRow[]>([
    { ...EMPTY_ORDER_FORM_ITEM },
  ]);

  const [search, setSearch] = useState("");
  const [clientIdFilter, setClientIdFilter] = useState("");
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [tab, setTab] = useState<OrderTab>(() => {
    const requested = getQueryParam("tab");
    return requested === "awaiting" || requested === "paid" ? requested : "work";
  });
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [exporting, setExporting] = useState(false);

  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditOrders = canEdit("orders");
  const canEditShipments = canEdit("shipments");

  const { data: orders, isLoading, isError: ordersError } = useListOrders(
    monthFilter === "all" ? undefined :
      { plannedMonth: monthFilter === "without" ? "without" : selectedMonth },
  );
  const { data: clients } = useListOrderClientLookup();
  const { data: products } = useListOrderProductLookup();
  const {
    data: sites,
    isLoading: sitesLoading,
    isError: sitesError,
  } = useListOrderSiteLookup();

  useEffect(() => {
    const id = getQueryParam("clientId");
    if (id) setClientIdFilter(id);
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  };

  const createOrder = useCreateOrder({
    mutation: {
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDeliveryDashboardSummaryQueryKey() });
        setDialogOpen(false);
        toast({ title: "Заказ создан" });
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  function openCreateDialog() {
    setClientId("");
    setSiteId("");
    setNote("");
    setPlannedMonth("");
    setPlannedDeliveryDate("");
    setItems([{ ...EMPTY_ORDER_FORM_ITEM }]);
    setDialogOpen(true);
  }

  function openCopyDialog(order: NonNullable<typeof orders>[number]) {
    setClientId(order.clientId);
    setSiteId(
      copiedOrderSiteSelection(order.siteId, order.clientId, sites ?? []),
    );
    setNote(order.note ?? "");
    setPlannedMonth(order.plannedMonth ?? "");
    setPlannedDeliveryDate("");
    setItems(
      order.items.map((item) => {
        const product = (products ?? []).find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          quantity: String(item.quantity),
          price: product ? String(product.price) : String(item.price),
        };
      }),
    );
    setDialogOpen(true);
  }

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    setSiteId(
      siteSelectionAfterClientChange(siteId, nextClientId, sites ?? []),
    );
  }

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function handleProductSelect(index: number, productId: string) {
    const product = (products ?? []).find((p) => p.id === productId);
    updateItem(index, {
      productId,
      price: product ? String(product.price) : "0",
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ORDER_FORM_ITEM }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validMonth(plannedMonth) || !plannedDeliveryDate || plannedDeliveryDate.slice(0, 7) !== plannedMonth || !orderSiteIdForRequest(siteId)) {
      toast({ title: "Укажите магазин и дату доставки в месяце плана", variant: "destructive" });
      return;
    }

    const validItems = items.filter(
      (item) => item.productId && Number(item.quantity) > 0,
    );
    if (validItems.length === 0) {
      toast({ title: "Добавьте хотя бы одну позицию", variant: "destructive" });
      return;
    }

    createOrder.mutate({
      data: {
        clientId,
        siteId: orderSiteIdForRequest(siteId),
        note: note || undefined,
        plannedMonth,
        plannedDeliveryDate,
        items: validItems.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          price: Number(item.price),
        })),
      },
    });
  }

  async function handleExport() {
    if (exporting || isLoading || !orders?.length) return;
    setExporting(true);
    try {
      // Fetch the unfiltered collection afresh; neither UI filters nor cached results
      // should turn an export into an incomplete snapshot.
      const allOrders = await listOrders();
      if (!Array.isArray(allOrders) || allOrders.length === 0) {
        throw new Error("Заказы для выгрузки не найдены");
      }
      downloadOrdersWorkbook(allOrders);
    } catch (error) {
      toast({
        title: "Не удалось выгрузить заказы",
        description: error instanceof Error ? error.message : "Не удалось получить заказы",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (orders ?? []).filter((order) => {
      if (q) {
        const haystack = [
          order.clientName,
          order.siteName ?? "",
          order.siteAddress ?? "",
          order.id.slice(0, 8),
          order.orderNumber,
          order.note ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (!orderMatchesTab(order.status, tab)) return false;
      if (clientIdFilter && order.clientId !== clientIdFilter) return false;
      if (paidFilter === "paid" && order.status !== "paid") return false;
      if (paidFilter === "awaiting_payment" && order.status !== "awaiting_payment") return false;
      if (paidFilter === "unbilled" && isOrderBilled(order)) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "clientName":
          return a.clientName.localeCompare(b.clientName, "ru") * dir;
        case "itemsCount":
          return (a.items.length - b.items.length) * dir;
        case "totalAmount":
          return (a.totalAmount - b.totalAmount) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "createdAt":
          return (
            (new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()) *
            dir
          );
        default:
          return 0;
      }
    });
  }, [
    orders,
    search,
    tab,
    clientIdFilter,
    paidFilter,
    sortField,
    sortDir,
  ]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const tabCounts = useMemo(() => {
    const counts: Record<OrderTab, number> = { work: 0, awaiting: 0, paid: 0 };
    for (const o of orders ?? []) {
      for (const t of ORDER_TABS) if (orderMatchesTab(o.status, t.value)) counts[t.value] += 1;
    }
    return counts;
  }, [orders]);
  const activeFilterCount = [
    clientIdFilter,
    paidFilter !== "all" ? paidFilter : "",
    monthFilter !== "all" ? monthFilter : "",
  ].filter(Boolean).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0 space-y-6 max-h-[65%] overflow-y-auto" data-testid="orders-fixed-header">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Заказы клиентов
      </h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Заказы и статус оплаты/отгрузки
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isLoading || !orders?.length || exporting}
            title="Все заказы всех клиентов, независимо от поиска и фильтров"
            data-testid="button-export-all-orders"
          >
            <Download className="h-4 w-4 mr-2" />
            {exporting ? "Выгрузка..." : "Выгрузить в Excel"}
          </Button>
          <Link href="/order-summaries">
            <Button variant="outline" data-testid="button-open-summaries">
              <FileStack className="h-4 w-4 mr-2" />
              Итоговые заказы
            </Button>
          </Link>
          {canEditOrders && (
            <Button onClick={openCreateDialog} data-testid="button-add-order">
              <Plus className="h-4 w-4 mr-2" />
              Новый заказ
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Excel содержит все заказы всех клиентов, независимо от поиска и фильтров.
      </p>

      <div className="flex flex-wrap gap-1 border-b" role="tablist" data-testid="order-tabs">
        {ORDER_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === t.value ? "border-blue-900 text-blue-900" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-orders-${t.value}`}
          >
            {t.label}
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{tabCounts[t.value]}</span>
          </button>
        ))}
        <Link
          href="/order-summaries"
          role="tab"
          aria-selected={false}
          className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="tab-orders-summaries"
        >
          Итоговые заказы
        </Link>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value as typeof monthFilter)}
          className="h-10 w-44 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Фильтр по месяцу" data-testid="select-order-month-filter">
          <option value="all">Все месяцы</option>
          <option value="month">За месяц</option>
          <option value="without">Без месяца</option>
        </select>
        {monthFilter === "month" && (
          <Input type="month" className="w-44" value={selectedMonth}
            onChange={(e) => { if (validMonth(e.target.value)) setSelectedMonth(e.target.value); }}
            data-testid="input-order-month-filter" />
        )}
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по заказам..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-orders"
          />
        </div>
        <select
          value={clientIdFilter}
          onChange={(e) => setClientIdFilter(e.target.value)}
          className="h-10 w-56 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Фильтр по клиенту"
          data-testid="select-filter-order-client"
        >
          <option value="">Все клиенты</option>
          {(clients ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={paidFilter}
          onChange={(e) => setPaidFilter(e.target.value as PaidFilter)}
          className="h-10 w-52 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Фильтр по статусу оплаты"
          data-testid="select-filter-paid"
        >
          <option value="all">Оплата: все</option>
          <option value="unbilled">Не выставлен</option>
          <option value="awaiting_payment">Ожидает оплаты</option>
          <option value="paid">Оплачен</option>
        </select>
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setClientIdFilter("");
              setPaidFilter("all");
              setMonthFilter("all");
            }}
            data-testid="button-reset-order-filters"
          >
            <X className="h-4 w-4 mr-1" />
            Сбросить фильтры ({activeFilterCount})
          </Button>
        )}
      </div>

      </div>
      <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
        <Table
          className="text-xs"
          containerClassName="h-full overflow-auto"
        >
          <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
            <TableRow>
              <SortableHeader
                field="clientName"
                label="Клиент"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead>Магазин</TableHead>
              <TableHead>Месяц плана</TableHead>
              <SortableHeader
                field="itemsCount"
                label="Позиций"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="totalAmount"
                label="Сумма"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className="text-right"
                align="right"
              />
              <SortableHeader
                field="status"
                label="Статус"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="createdAt"
                label="Создан"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : filteredOrders.length > 0 ? (
              filteredOrders.map((order) => (
                <TableRow
                  key={order.id}
                  data-testid={`row-order-${order.id}`}
                  className="cursor-pointer"
                  onDoubleClick={() => navigate(`/orders/${order.id}`)}
                >
                  <TableCell className="font-medium py-1.5">
                    {order.clientName}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {order.siteName ? (
                      <div>
                        <div className="font-medium">{order.siteName}</div>
                        <div className="text-muted-foreground">
                          {order.siteAddress || "Адрес не указан"}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        Без привязки к магазину
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5 whitespace-nowrap" data-testid={`month-order-${order.id}`}>
                    {order.plannedMonth ?? "Без месяца"}
                    {order.monthFromDelivery && <span className="block text-muted-foreground" title="Месяц берётся из исходного плана доставки">Из доставки</span>}
                  </TableCell>
                  <TableCell className="py-1.5">{order.items.length}</TableCell>
                  <TableCell className="text-right py-1.5">
                    {currency.format(order.totalAmount)}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Badge variant="outline" className={ORDER_STATUS_CLASSES[order.status]} data-testid={`status-order-${order.id}`}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap py-1.5">
                    {dateFormatter.format(new Date(order.createdAt))}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex items-center gap-1">
                      <Link href={`/orders/${order.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-open-order-${order.id}`}
                        >
                          Открыть
                        </Button>
                      </Link>
                      {canEditShipments &&
                        !isOrderBilled(order) &&
                        order.items.some((i) => i.remainingQuantity > 0) && (
                          <Link href={`/shipments?orderId=${order.id}`}>
                            <Button
                              variant="outline"
                              size="icon"
                              title="Создать доставку"
                              data-testid={`button-ship-order-${order.id}`}
                            >
                              <Truck className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        )}
                      {canEditOrders && (
                        <Button
                          variant="outline"
                          size="icon"
                          title="Копировать заказ"
                          onClick={() => openCopyDialog(order)}
                          disabled={sitesLoading}
                          data-testid={`button-copy-order-${order.id}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Link href={`/orders/${order.id}/print`}>
                        <Button
                          variant="outline"
                          size="icon"
                          data-testid={`button-print-order-${order.id}`}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  {ordersError ? "Не удалось загрузить заказы" : (orders ?? []).length > 0 ? "Нет заказов по выбранной вкладке и фильтрам" : "Заказов пока нет"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новый заказ</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="order-planned-month">Месяц плана *</Label>
              <div className="flex gap-2">
                <Input id="order-planned-month" type="month" required value={plannedMonth}
                  onChange={(e) => setPlannedMonth(e.target.value)} data-testid="input-create-order-month" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="order-delivery-date">Дата доставки *</Label>
              <p className="text-sm text-muted-foreground">Выберите магазин и дату — заказ автоматически появится в графике доставок.</p>
              <Input id="order-delivery-date" type="date" required value={plannedDeliveryDate}
                onChange={(e) => {
                  setPlannedDeliveryDate(e.target.value);
                  if (e.target.value) setPlannedMonth(e.target.value.slice(0, 7));
                }} data-testid="input-create-order-delivery-date" />
            </div>
            <OrderFormFields
              clients={clients ?? []}
              products={products ?? []}
              clientId={clientId}
              onClientChange={handleClientChange}
              sites={sites ?? []}
              siteId={siteId}
              onSiteChange={setSiteId}
              sitesLoading={sitesLoading}
              sitesError={sitesError}
              items={items}
              onItemChange={updateItem}
              onProductSelect={handleProductSelect}
              onAddItem={addItem}
              onRemoveItem={removeItem}
              note={note}
              onNoteChange={setNote}
            />

            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  createOrder.isPending || !clientId || !orderSiteIdForRequest(siteId) || sitesError || !validMonth(plannedMonth) || !plannedDeliveryDate || plannedDeliveryDate.slice(0, 7) !== plannedMonth
                }
                data-testid="button-save-order"
              >
                Создать заказ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
