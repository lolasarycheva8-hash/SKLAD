import { useEffect, useMemo, useState } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListShipments,
  useListShipmentOrderLookup,
  useGetShipmentOrderLookup,
  useGetShipment,
  useListShipmentSiteLookup,
  useListDrivers,
  useCreateShipment,
  useDeleteShipment,
  getListShipmentsQueryKey,
  getGetShipmentOrderLookupQueryKey,
  getGetShipmentQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Search,
  Filter,
  X,
  Copy,
  ExternalLink,
  Trash2,
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

type ShipmentItemRow = {
  productId: string;
  quantity: string;
};

type SortField =
  | "shipmentNumber"
  | "orderNumber"
  | "clientName"
  | "siteName"
  | "driver"
  | "shipmentDate"
  | "totalAmount"
  | "createdAt";

export default function Shipments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { canEdit, isAdmin } = usePermissions();
  const canEditShipments = canEdit("shipments");

  const { data: shipments, isLoading } = useListShipments();
  const [deleteTarget, setDeleteTarget] = useState<
    NonNullable<typeof shipments>[number] | null
  >(null);
  const [deleteNote, setDeleteNote] = useState("");
  const { data: orders } = useListShipmentOrderLookup();
  const { data: sites } = useListShipmentSiteLookup();
  const { data: drivers = [] } = useListDrivers();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [driver, setDriver] = useState("");
  const [driverTouched, setDriverTouched] = useState(false);
  const [shipmentDate, setShipmentDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState("");
  const [shipItems, setShipItems] = useState<ShipmentItemRow[]>([]);
  const [copySourceItems, setCopySourceItems] = useState<
    ShipmentItemRow[] | null
  >(null);

  const searchString = useSearch();
  const prefilledOrderIdRef = useMemo(
    () => new URLSearchParams(searchString).get("orderId"),
    [searchString],
  );
  const copyFromShipmentId = useMemo(
    () => new URLSearchParams(searchString).get("copyFrom"),
    [searchString],
  );

  const { data: copyFromShipment } = useGetShipment(
    copyFromShipmentId || "placeholder",
    {
      query: {
        enabled: !!copyFromShipmentId,
        queryKey: getGetShipmentQueryKey(copyFromShipmentId || "placeholder"),
      },
    },
  );

  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [orderNumberFilter, setOrderNumberFilter] = useState("");
  const [shipmentNumberFilter, setShipmentNumberFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const { data: selectedOrder } = useGetShipmentOrderLookup(orderId || "placeholder", {
    query: {
      enabled: !!orderId,
      queryKey: getGetShipmentOrderLookupQueryKey(orderId || "placeholder"),
    },
  });

  useEffect(() => {
    if (selectedOrder) {
      setShipItems(
        selectedOrder.items
          .filter((item) => item.remainingQuantity > 0)
          .map((item) => {
            const copied = copySourceItems?.find(
              (c) => c.productId === item.productId,
            );
            const qty = copied
              ? Math.min(Number(copied.quantity), item.remainingQuantity)
              : item.remainingQuantity;
            return { productId: item.productId, quantity: String(qty) };
          }),
      );
    } else {
      setShipItems([]);
    }
  }, [selectedOrder, copySourceItems]);

  useEffect(() => {
    if (driverTouched) return;
    const site = (sites ?? []).find((s) => s.id === siteId);
    if (site) setDriver(site.driverUserId ?? "");
  }, [siteId, sites, driverTouched]);

  useEffect(() => {
    if (
      prefilledOrderIdRef &&
      orders?.some((o) => o.id === prefilledOrderIdRef)
    ) {
      setOrderId(prefilledOrderIdRef);
      setSiteId("");
      setDriver("");
      setDriverTouched(false);
      setShipmentDate(new Date().toISOString().slice(0, 10));
      setNote("");
      setCopySourceItems(null);
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledOrderIdRef, orders]);

  useEffect(() => {
    if (copyFromShipmentId && copyFromShipment) {
      openCopyDialog(copyFromShipment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyFromShipmentId, copyFromShipment]);

  const invalidateShipments = () => {
    queryClient.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
  };

  const deleteShipment = useDeleteShipment({
    mutation: {
      onSuccess: () => {
        invalidateShipments();
        setDeleteTarget(null);
        setDeleteNote("");
        toast({ title: "Отгрузка помечена на удаление" });
      },
      onError: (error: any) => {
        toast({
          title: "Ошибка",
          description: error?.response?.data?.error ?? error.message,
          variant: "destructive",
        });
      },
    },
  });

  function confirmDelete() {
    if (!deleteTarget || !deleteNote.trim()) return;
    deleteShipment.mutate({
      id: deleteTarget.id,
      data: { note: deleteNote.trim() },
    });
  }

  const createShipment = useCreateShipment({
    mutation: {
      onSuccess: () => {
        invalidateShipments();
        setDialogOpen(false);
        toast({ title: "Отгрузка создана" });
      },
      onError: (error: any) => {
        toast({
          title: "Ошибка",
          description: error?.response?.data?.error ?? error.message,
          variant: "destructive",
        });
      },
    },
  });

  function openCreateDialog() {
    setOrderId("");
    setSiteId("");
    setDriver("");
    setDriverTouched(false);
    setShipmentDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setShipItems([]);
    setCopySourceItems(null);
    setDialogOpen(true);
  }

  function openCopyDialog(shipment: NonNullable<typeof shipments>[number]) {
    setOrderId(shipment.orderId);
    setSiteId(shipment.siteId);
    setDriver(shipment.driverUserId ?? "");
    setDriverTouched(true);
    setShipmentDate(new Date().toISOString().slice(0, 10));
    setNote(shipment.note ?? "");
    setCopySourceItems(
      shipment.items.map((item) => ({
        productId: item.productId,
        quantity: String(item.quantity),
      })),
    );
    setDialogOpen(true);
  }

  function updateShipItem(productId: string, quantity: string) {
    setShipItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, quantity } : item,
      ),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = shipItems.filter((item) => Number(item.quantity) > 0);
    if (!orderId || !siteId || validItems.length === 0) {
      toast({
        title: "Заполните заказ, объект и хотя бы одну позицию",
        variant: "destructive",
      });
      return;
    }

    createShipment.mutate({
      data: {
        orderId,
        siteId,
        driverUserId: driver || null,
        shipmentDate,
        note: note || undefined,
        items: validItems.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
        })),
      },
    });
  }

  const payableOrders = (orders ?? []).filter(
    (o) => o.isPaid && o.items.some((i) => i.remainingQuantity > 0),
  );

  const filteredShipments = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (shipments ?? []).filter((shipment) => {
      const shipmentNumber = shipment.id.slice(0, 8);
      if (q) {
        const haystack = [
          shipmentNumber,
          shipment.orderNumber,
          shipment.clientName,
          shipment.siteName,
          shipment.driver,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (
        clientFilter &&
        !shipment.clientName.toLowerCase().includes(clientFilter.toLowerCase())
      )
        return false;
      if (siteFilter && shipment.siteId !== siteFilter) return false;
      if (
        driverFilter &&
        !shipment.driver.toLowerCase().includes(driverFilter.toLowerCase())
      )
        return false;
      if (
        orderNumberFilter &&
        !shipment.orderNumber
          .toLowerCase()
          .includes(orderNumberFilter.toLowerCase())
      )
        return false;
      if (
        shipmentNumberFilter &&
        !shipmentNumber
          .toLowerCase()
          .includes(shipmentNumberFilter.toLowerCase())
      )
        return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "shipmentNumber":
          return a.id.slice(0, 8).localeCompare(b.id.slice(0, 8), "ru") * dir;
        case "orderNumber":
          return a.orderNumber.localeCompare(b.orderNumber, "ru") * dir;
        case "clientName":
          return a.clientName.localeCompare(b.clientName, "ru") * dir;
        case "siteName":
          return a.siteName.localeCompare(b.siteName, "ru") * dir;
        case "driver":
          return a.driver.localeCompare(b.driver, "ru") * dir;
        case "shipmentDate":
          return (
            (new Date(a.shipmentDate).getTime() -
              new Date(b.shipmentDate).getTime()) *
            dir
          );
        case "totalAmount":
          return (a.totalAmount - b.totalAmount) * dir;
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
    shipments,
    search,
    clientFilter,
    siteFilter,
    driverFilter,
    orderNumberFilter,
    shipmentNumberFilter,
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

  const activeFilterCount = [
    clientFilter,
    siteFilter,
    driverFilter,
    orderNumberFilter,
    shipmentNumberFilter,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Отгрузки
      </h1>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Все отгрузки по заказам клиентов
          </p>
        </div>
        {canEditShipments && (
          <Button onClick={openCreateDialog} data-testid="button-add-shipment">
            <Plus className="h-4 w-4 mr-2" />
            Новая отгрузка
          </Button>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по отгрузкам..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-shipments"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              data-testid="button-open-shipment-filters"
            >
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
              <Label>Отгрузка №</Label>
              <Input
                placeholder="Фильтр по номеру отгрузки..."
                value={shipmentNumberFilter}
                onChange={(e) => setShipmentNumberFilter(e.target.value)}
                data-testid="input-filter-shipment-number"
              />
            </div>
            <div className="space-y-2">
              <Label>Заказ №</Label>
              <Input
                placeholder="Фильтр по номеру заказа..."
                value={orderNumberFilter}
                onChange={(e) => setOrderNumberFilter(e.target.value)}
                data-testid="input-filter-order-number"
              />
            </div>
            <div className="space-y-2">
              <Label>Клиент</Label>
              <Input
                placeholder="Фильтр по клиенту..."
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                data-testid="input-filter-client"
              />
            </div>
            <div className="space-y-2">
              <Label>Объект</Label>
              <Select
                value={siteFilter || "all"}
                onValueChange={(value) =>
                  setSiteFilter(value === "all" ? "" : value)
                }
              >
                <SelectTrigger data-testid="select-filter-site">
                  <SelectValue placeholder="Все объекты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все объекты</SelectItem>
                  {(sites ?? []).map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Водитель</Label>
              <Input
                placeholder="Фильтр по водителю..."
                value={driverFilter}
                onChange={(e) => setDriverFilter(e.target.value)}
                data-testid="input-filter-driver"
              />
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setShipmentNumberFilter("");
                  setOrderNumberFilter("");
                  setClientFilter("");
                  setSiteFilter("");
                  setDriverFilter("");
                }}
                data-testid="button-reset-shipment-filters"
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
                field="shipmentNumber"
                label="Отгрузка №"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="orderNumber"
                label="Заказ №"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="clientName"
                label="Клиент"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="siteName"
                label="Объект"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="driver"
                label="Водитель"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="shipmentDate"
                label="Дата"
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
              <TableHead>Статус</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground py-8"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : filteredShipments.length > 0 ? (
              filteredShipments.map((shipment) => (
                <TableRow
                  key={shipment.id}
                  data-testid={`row-shipment-${shipment.id}`}
                  className={`cursor-pointer ${shipment.isDeleted ? "opacity-50" : ""}`}
                  onDoubleClick={() => navigate(`/shipments/${shipment.id}`)}
                >
                  <TableCell
                    className={`py-1.5 font-medium ${shipment.isDeleted ? "line-through" : ""}`}
                  >
                    {shipment.id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {shipment.orderNumber}
                  </TableCell>
                  <TableCell className="font-medium py-1.5">
                    {shipment.clientName}
                  </TableCell>
                  <TableCell className="py-1.5">{shipment.siteName}</TableCell>
                  <TableCell className="py-1.5">{shipment.driver}</TableCell>
                  <TableCell className="py-1.5">
                    {dateFormatter.format(new Date(shipment.shipmentDate))}
                  </TableCell>
                  <TableCell className="text-right py-1.5">
                    {currency.format(shipment.totalAmount)}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {shipment.isDeleted ? (
                      <Badge
                        variant="outline"
                        className="bg-red-100 text-red-800 hover:bg-red-100"
                      >
                        Удалено
                      </Badge>
                    ) : shipment.isDispatched ? (
                      <Badge
                        variant="outline"
                        className="bg-green-100 text-green-800 hover:bg-green-100"
                      >
                        Отгружено
                      </Badge>
                    ) : (
                      <Badge variant="outline">В работе</Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex items-center gap-1">
                      <Link href={`/shipments/${shipment.id}`}>
                        <Button
                          variant="outline"
                          size="icon"
                          title="Открыть"
                          data-testid={`button-open-shipment-${shipment.id}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      {canEditShipments && (
                        <Button
                          variant="outline"
                          size="icon"
                          title="Копировать отгрузку"
                          onClick={() => openCopyDialog(shipment)}
                          data-testid={`button-copy-shipment-${shipment.id}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {shipment.isDispatched && !shipment.isDeleted && (
                        <Link href={`/shipments/${shipment.id}/print`}>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`button-print-shipment-${shipment.id}`}
                          >
                            <Printer className="h-3.5 w-3.5 mr-1" />
                            Накладная
                          </Button>
                        </Link>
                      )}
                      {isAdmin && !shipment.isDeleted && (
                        <Button
                          variant="outline"
                          size="icon"
                          title="Пометить на удаление"
                          onClick={() => {
                            setDeleteTarget(shipment);
                            setDeleteNote("");
                          }}
                          data-testid={`button-delete-shipment-${shipment.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground py-8"
                >
                  Отгрузок пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Пометить отгрузку на удаление</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Отгрузка №{deleteTarget?.id.slice(0, 8)} будет помечена как
              удалённая, товар вернётся на склад. Редактирование будет
              недоступно — при необходимости создайте новую отгрузку. Действие
              нельзя отменить.
            </p>
            <div className="space-y-2">
              <Label htmlFor="deleteNote">Причина удаления (обязательно)</Label>
              <Textarea
                id="deleteNote"
                required
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                data-testid="input-shipment-delete-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={!deleteNote.trim() || deleteShipment.isPending}
              data-testid="button-confirm-delete-shipment"
            >
              Пометить на удаление
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новая отгрузка</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Заказ</Label>
              <Select value={orderId} onValueChange={setOrderId} required>
                <SelectTrigger data-testid="select-shipment-order">
                  <SelectValue placeholder="Выберите оплаченный заказ" />
                </SelectTrigger>
                <SelectContent>
                  {payableOrders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      №{order.id.slice(0, 8)} — {order.clientName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {payableOrders.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Нет оплаченных заказов с неотгруженными позициями
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Объект</Label>
              <Select value={siteId} onValueChange={setSiteId} required>
                <SelectTrigger data-testid="select-shipment-site">
                  <SelectValue placeholder="Выберите объект" />
                </SelectTrigger>
                <SelectContent>
                  {(sites ?? []).map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="driver">Водитель</Label>
                <Select
                  value={driver || "__none__"}
                  onValueChange={(value) => {
                    setDriver(value === "__none__" ? "" : value);
                    setDriverTouched(true);
                  }}
                >
                  <SelectTrigger id="driver" data-testid="select-shipment-driver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Не назначен</SelectItem>
                    {drivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name || driver.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="shipmentDate">Дата отгрузки</Label>
                <Input
                  id="shipmentDate"
                  type="date"
                  required
                  value={shipmentDate}
                  onChange={(e) => setShipmentDate(e.target.value)}
                  data-testid="input-shipment-date"
                />
              </div>
            </div>

            {selectedOrder && (
              <div className="space-y-2">
                <Label>Позиции к отгрузке</Label>
                <div className="space-y-2">
                  {selectedOrder.items
                    .filter((item) => item.remainingQuantity > 0)
                    .map((item) => {
                      const row = shipItems.find(
                        (r) => r.productId === item.productId,
                      );
                      return (
                        <div key={item.id} className="flex items-center gap-2">
                          <div className="flex-1 text-sm">
                            {item.productName}{" "}
                            <span className="text-muted-foreground">
                              (остаток: {item.remainingQuantity})
                            </span>
                          </div>
                          <Input
                            type="number"
                            min="0"
                            max={item.remainingQuantity}
                            step="0.01"
                            className="w-28"
                            value={row?.quantity ?? "0"}
                            onChange={(e) =>
                              updateShipItem(item.productId, e.target.value)
                            }
                            data-testid={`input-shipment-item-quantity-${item.productId}`}
                          />
                        </div>
                      );
                    })}
                  {selectedOrder.items.every(
                    (item) => item.remainingQuantity <= 0,
                  ) && (
                    <p className="text-xs text-muted-foreground">
                      Заказ уже полностью отгружен
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="shipmentNote">Примечание</Label>
              <Textarea
                id="shipmentNote"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="input-shipment-note"
              />
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  createShipment.isPending || !orderId || !siteId
                }
                data-testid="button-save-shipment"
              >
                Создать отгрузку
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
