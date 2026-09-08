import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useCreateOrder,
  useListOrderClientLookup,
  useListOrderProductLookup,
  getListOrdersQueryKey,
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SortableHeader,
  type SortDirection,
} from "@/components/sortable-header";
import {
  Plus,
  Printer,
  Trash2,
  Search,
  Filter,
  X,
  Truck,
  Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

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

type ItemRow = {
  productId: string;
  quantity: string;
  price: string;
};

const EMPTY_ITEM: ItemRow = { productId: "", quantity: "1", price: "0" };

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

type SortField =
  | "clientName"
  | "itemsCount"
  | "totalAmount"
  | "isPaid"
  | "createdAt";
type PaidFilter = "all" | "paid" | "unpaid";

export default function Orders() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [clientIdFilter, setClientIdFilter] = useState("");
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditOrders = canEdit("orders");
  const canEditShipments = canEdit("shipments");

  const { data: orders, isLoading } = useListOrders();
  const { data: clients } = useListOrderClientLookup();
  const { data: products } = useListOrderProductLookup();

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
    setNote("");
    setItems([{ ...EMPTY_ITEM }]);
    setDialogOpen(true);
  }

  function openCopyDialog(order: NonNullable<typeof orders>[number]) {
    setClientId(order.clientId);
    setNote(order.note ?? "");
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
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

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
        note: note || undefined,
        items: validItems.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          price: Number(item.price),
        })),
      },
    });
  }

  const totalPreview = items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    return sum + qty * price;
  }, 0);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (orders ?? []).filter((order) => {
      if (q) {
        const haystack = [
          order.clientName,
          order.id.slice(0, 8),
          order.note ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (
        clientFilter &&
        !order.clientName.toLowerCase().includes(clientFilter.toLowerCase())
      )
        return false;
      if (clientIdFilter && order.clientId !== clientIdFilter) return false;
      if (paidFilter === "paid" && !order.isPaid) return false;
      if (paidFilter === "unpaid" && order.isPaid) return false;
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
        case "isPaid":
          return (Number(a.isPaid) - Number(b.isPaid)) * dir;
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
    clientFilter,
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

  const clientIdFilterName = clientIdFilter
    ? ((clients ?? []).find((c) => c.id === clientIdFilter)?.name ?? "")
    : "";
  const activeFilterCount = [
    clientFilter,
    clientIdFilter,
    paidFilter !== "all" ? paidFilter : "",
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Заказы клиентов
      </h1>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Заказы и статус оплаты/отгрузки
          </p>
        </div>
        {canEditOrders && (
          <Button onClick={openCreateDialog} data-testid="button-add-order">
            <Plus className="h-4 w-4 mr-2" />
            Новый заказ
          </Button>
        )}
      </div>

      {clientIdFilter && (
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="gap-1"
            data-testid="badge-client-filter"
          >
            Клиент: {clientIdFilterName || "—"}
            <button
              type="button"
              onClick={() => setClientIdFilter("")}
              className="ml-1"
              data-testid="button-clear-client-filter"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
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
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" data-testid="button-open-order-filters">
              <Filter className="h-4 w-4 mr-2" />
              Фильтры
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-3" align="start">
            <div className="space-y-2">
              <Label>Клиент</Label>
              <Input
                placeholder="Фильтр по клиенту..."
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                data-testid="input-filter-order-client"
              />
            </div>
            <div className="space-y-2">
              <Label>Оплата</Label>
              <Select
                value={paidFilter}
                onValueChange={(value) => setPaidFilter(value as PaidFilter)}
              >
                <SelectTrigger data-testid="select-filter-paid">
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="paid">Оплачен</SelectItem>
                  <SelectItem value="unpaid">Не оплачен</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setClientFilter("");
                  setPaidFilter("all");
                }}
                data-testid="button-reset-order-filters"
              >
                <X className="h-4 w-4 mr-1" />
                Сбросить фильтры
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <SortableHeader
                field="clientName"
                label="Клиент"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
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
                field="isPaid"
                label="Оплата"
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
                  colSpan={6}
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
                  <TableCell className="py-1.5">{order.items.length}</TableCell>
                  <TableCell className="text-right py-1.5">
                    {currency.format(order.totalAmount)}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {order.isPaid ? (
                      <Badge
                        className="bg-green-100 text-green-800 hover:bg-green-100"
                        variant="outline"
                      >
                        Оплачен
                      </Badge>
                    ) : (
                      <Badge
                        className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
                        variant="outline"
                      >
                        Ожидается оплата
                      </Badge>
                    )}
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
                        order.isPaid &&
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
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  Заказов пока нет
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
              <Label>Клиент</Label>
              <Select value={clientId} onValueChange={setClientId} required>
                <SelectTrigger data-testid="select-order-client">
                  <SelectValue placeholder="Выберите клиента" />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Позиции заказа</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                  data-testid="button-add-order-item"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Добавить позицию
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select
                      value={item.productId}
                      onValueChange={(value) =>
                        handleProductSelect(index, value)
                      }
                    >
                      <SelectTrigger
                        className="flex-1"
                        data-testid={`select-order-item-product-${index}`}
                      >
                        <SelectValue placeholder="Товар" />
                      </SelectTrigger>
                      <SelectContent>
                        {(products ?? []).map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} ({product.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="w-24"
                      placeholder="Кол-во"
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(index, { quantity: e.target.value })
                      }
                      data-testid={`input-order-item-quantity-${index}`}
                    />
                    <Input
                      type="number"
                      className="w-28"
                      placeholder="Цена"
                      value={item.price}
                      readOnly
                      disabled
                      title="Цена подтягивается из справочника товаров"
                      data-testid={`input-order-item-price-${index}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(index)}
                      disabled={items.length === 1}
                      data-testid={`button-remove-order-item-${index}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="text-sm text-muted-foreground text-right">
                Итого:{" "}
                <span className="font-medium text-foreground">
                  {currency.format(totalPreview)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Примечание</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="input-order-note"
              />
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={createOrder.isPending || !clientId}
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
