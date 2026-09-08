import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetShipment,
  useUpdateShipment,
  useDispatchShipment,
  useDeleteShipment,
  useListShipmentSiteLookup,
  useListDrivers,
  useGetShipmentOrderLookup,
  useListShipmentProductLookup,
  getGetShipmentQueryKey,
  getListShipmentsQueryKey,
  getGetShipmentOrderLookupQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { ArrowLeft, Printer, Pencil, Save, X, Truck, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

type EditableShipmentItem = {
  productId: string;
  productName: string;
  productUnit: string;
  price: number;
  quantity: string;
  maxQuantity: number;
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export default function ShipmentDetail() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id!;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit, isAdmin } = usePermissions();
  const canEditShipments = canEdit("shipments");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteNote, setDeleteNote] = useState("");

  const { data: shipment, isLoading } = useGetShipment(shipmentId);
  const { data: sites } = useListShipmentSiteLookup();
  const { data: drivers = [] } = useListDrivers();
  const { data: products } = useListShipmentProductLookup();
  const { data: order } = useGetShipmentOrderLookup(shipment?.orderId || "placeholder", {
    query: {
      enabled: !!shipment?.orderId,
      queryKey: getGetShipmentOrderLookupQueryKey(shipment?.orderId || "placeholder"),
    },
  });

  const [editing, setEditing] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [driver, setDriver] = useState("");
  const [shipmentDate, setShipmentDate] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<EditableShipmentItem[]>([]);
  const [addProductId, setAddProductId] = useState("");

  useEffect(() => {
    if (shipment) {
      setSiteId(shipment.siteId);
      setDriver(shipment.driverUserId ?? "");
      setShipmentDate(shipment.shipmentDate);
      setNote(shipment.note ?? "");
    }
  }, [shipment]);

  function buildInitialItems(): EditableShipmentItem[] {
    if (!shipment || !order) return [];
    return shipment.items.map((item) => {
      const orderItem = order.items.find((oi) => oi.productId === item.productId);
      const orderedQty = orderItem?.quantity ?? item.quantity;
      const shippedElsewhere = (orderItem?.shippedQuantity ?? item.quantity) - item.quantity;
      return {
        productId: item.productId,
        productName: item.productName,
        productUnit: item.productUnit,
        price: item.price,
        quantity: String(item.quantity),
        maxQuantity: orderedQty - shippedElsewhere,
      };
    });
  }

  useEffect(() => {
    setItems(buildInitialItems());
  }, [shipment, order]);

  const updateShipment = useUpdateShipment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetShipmentQueryKey(shipmentId) });
        queryClient.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
        if (shipment) {
          queryClient.invalidateQueries({ queryKey: getGetShipmentOrderLookupQueryKey(shipment.orderId) });
        }
        setEditing(false);
        setAddProductId("");
        toast({ title: "Отгрузка обновлена" });
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

  const dispatchShipment = useDispatchShipment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetShipmentQueryKey(shipmentId) });
        queryClient.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
        toast({ title: "Отгрузка передана в доставку" });
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

  const deleteShipment = useDeleteShipment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetShipmentQueryKey(shipmentId) });
        queryClient.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
        setDeleteDialogOpen(false);
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
    if (!deleteNote.trim()) return;
    deleteShipment.mutate({ id: shipmentId, data: { note: deleteNote.trim() } });
  }

  function handleSave() {
    const validItems = items.filter((item) => Number(item.quantity) > 0);
    if (validItems.length === 0) {
      toast({ title: "Добавьте хотя бы одну позицию", variant: "destructive" });
      return;
    }
    updateShipment.mutate({
      id: shipmentId,
      data: {
        siteId,
        driverUserId: driver || null,
        shipmentDate,
        note: note || undefined,
        items: validItems.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
      },
    });
  }

  function cancelEdit() {
    if (shipment) {
      setSiteId(shipment.siteId);
      setDriver(shipment.driverUserId ?? "");
      setShipmentDate(shipment.shipmentDate);
      setNote(shipment.note ?? "");
    }
    setItems(buildInitialItems());
    setAddProductId("");
    setEditing(false);
  }

  function findProductUnit(productId: string): string {
    return shipment?.items.find((i) => i.productId === productId)?.productUnit ?? "";
  }

  function updateItemQuantity(productId: string, quantity: string) {
    if (quantity !== "" && (!/^\d*\.?\d*$/.test(quantity) || Number(quantity) < 0)) return;
    setItems((prev) => prev.map((item) => (item.productId === productId ? { ...item, quantity } : item)));
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((item) => item.productId !== productId));
  }

  function addProduct() {
    if (!addProductId || !order) return;
    if (items.some((item) => item.productId === addProductId)) return;
    const orderItem = order.items.find((oi) => oi.productId === addProductId);
    if (!orderItem) return;
    const currentInThisShipment = shipment?.items.find((i) => i.productId === addProductId)?.quantity ?? 0;
    const maxQuantity = orderItem.remainingQuantity + currentInThisShipment;
    const productUnit =
      findProductUnit(addProductId) || (products ?? []).find((p) => p.id === addProductId)?.unit || "";
    setItems((prev) => [
      ...prev,
      {
        productId: orderItem.productId,
        productName: orderItem.productName,
        productUnit,
        price: orderItem.price,
        quantity: String(maxQuantity),
        maxQuantity,
      },
    ]);
    setAddProductId("");
  }

  const availableToAdd = (order?.items ?? []).filter(
    (oi) => !items.some((item) => item.productId === oi.productId),
  );

  if (isLoading || !shipment) {
    return <div className="text-muted-foreground">Загрузка...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full" data-testid="text-page-title">
        Отгрузка №{shipment.id.slice(0, 8)}
      </h1>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/shipments">
            <Button variant="ghost" size="icon" data-testid="button-back-to-shipments">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-muted-foreground text-sm">
            Заказ №{shipment.orderNumber} — {shipment.clientName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {shipment.isDispatched && !shipment.isDeleted && (
            <Link href={`/shipments/${shipment.id}/print`}>
              <Button variant="outline" data-testid="button-print-shipment">
                <Printer className="h-4 w-4 mr-2" />
                Накладная
              </Button>
            </Link>
          )}
          {canEditShipments && !shipment.isDispatched && !shipment.isDeleted && (
            editing ? (
              <>
                <Button variant="outline" onClick={cancelEdit} data-testid="button-cancel-edit-shipment">
                  <X className="h-4 w-4 mr-2" />
                  Отмена
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateShipment.isPending || !siteId}
                  data-testid="button-save-shipment-edit"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Сохранить
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-shipment">
                  <Pencil className="h-4 w-4 mr-2" />
                  Редактировать
                </Button>
                <Button
                  onClick={() => dispatchShipment.mutate({ id: shipment.id })}
                  disabled={dispatchShipment.isPending}
                  data-testid="button-dispatch-shipment"
                >
                  <Truck className="h-4 w-4 mr-2" />
                  Передать в доставку
                </Button>
              </>
            )
          )}
          {isAdmin && !shipment.isDeleted && (
            <Button
              variant="outline"
              onClick={() => {
                setDeleteNote("");
                setDeleteDialogOpen(true);
              }}
              data-testid="button-delete-shipment"
            >
              <Trash2 className="h-4 w-4 mr-2 text-destructive" />
              Пометить на удаление
            </Button>
          )}
        </div>
      </div>

      {shipment.isDeleted && (
        <p className="text-sm text-destructive">
          Отгрузка помечена на удаление {shipment.deletedAt ? dateFormatter.format(new Date(shipment.deletedAt)) : ""}, товар возвращён на склад.
          Примечание: {shipment.deleteNote}
        </p>
      )}

      {shipment.isDispatched && !shipment.isDeleted && (
        <p className="text-sm text-muted-foreground">
          Отгрузка передана в доставку {shipment.dispatchedAt ? dateFormatter.format(new Date(shipment.dispatchedAt)) : ""} и больше не может быть изменена.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 border rounded-md p-4">
        <div className="space-y-2">
          <Label>Объект</Label>
          {editing ? (
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger data-testid="select-edit-site">
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
          ) : (
            <div className="text-sm">
              {shipment.siteName}
              <div className="text-xs text-muted-foreground">{shipment.siteAddress}</div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="driver">Водитель</Label>
          {editing ? (
            <Select
              value={driver || "__none__"}
              onValueChange={(value) => setDriver(value === "__none__" ? "" : value)}
            >
              <SelectTrigger id="driver" data-testid="select-edit-driver">
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
          ) : (
            <div className="text-sm">{shipment.driver}</div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="shipmentDate">Дата отгрузки</Label>
          {editing ? (
            <Input
              id="shipmentDate"
              type="date"
              value={shipmentDate}
              onChange={(e) => setShipmentDate(e.target.value)}
              data-testid="input-edit-date"
            />
          ) : (
            <div className="text-sm">{dateFormatter.format(new Date(shipment.shipmentDate))}</div>
          )}
        </div>
        <div className="space-y-2 col-span-2">
          <Label htmlFor="note">Примечание</Label>
          {editing ? (
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-edit-note" />
          ) : (
            <div className="text-sm text-muted-foreground">{shipment.note || "—"}</div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Состав отгрузки</h2>
        {!editing && !shipment.isDispatched && !shipment.isDeleted && (
          <p className="text-xs text-muted-foreground mb-2">
            Нажмите «Редактировать», чтобы изменить позиции и количество отгрузки.
          </p>
        )}
        <div className="border rounded-md overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Товар</TableHead>
                <TableHead className="text-right">Ед. изм.</TableHead>
                <TableHead className="text-right">Кол-во</TableHead>
                <TableHead className="text-right">Цена</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                {editing && <TableHead className="text-right w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {editing
                ? items.map((item) => (
                    <TableRow key={item.productId} data-testid={`row-edit-shipment-item-${item.productId}`}>
                      <TableCell className="font-medium py-1.5">{item.productName}</TableCell>
                      <TableCell className="text-right py-1.5">{item.productUnit}</TableCell>
                      <TableCell className="text-right py-1.5">
                        <Input
                          type="number"
                          min={0}
                          max={item.maxQuantity}
                          value={item.quantity}
                          onChange={(e) => updateItemQuantity(item.productId, e.target.value)}
                          className="w-24 ml-auto text-right"
                          data-testid={`input-item-quantity-${item.productId}`}
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          макс. {item.maxQuantity}
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-1.5">{currency.format(item.price)}</TableCell>
                      <TableCell className="text-right py-1.5">
                        {currency.format(item.price * (Number(item.quantity) || 0))}
                      </TableCell>
                      <TableCell className="text-right py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.productId)}
                          data-testid={`button-remove-item-${item.productId}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                : shipment.items.map((item) => (
                    <TableRow key={item.id} data-testid={`row-shipment-item-${item.id}`}>
                      <TableCell className="font-medium py-1.5">{item.productName}</TableCell>
                      <TableCell className="text-right py-1.5">{item.productUnit}</TableCell>
                      <TableCell className="text-right py-1.5">{item.quantity}</TableCell>
                      <TableCell className="text-right py-1.5">{currency.format(item.price)}</TableCell>
                      <TableCell className="text-right py-1.5">{currency.format(item.price * item.quantity)}</TableCell>
                    </TableRow>
                  ))}
              <TableRow>
                <TableCell colSpan={4} className="text-right font-medium py-1.5">
                  Итого
                </TableCell>
                <TableCell className="text-right font-medium py-1.5">
                  {editing
                    ? currency.format(
                        items.reduce((sum, item) => sum + item.price * (Number(item.quantity) || 0), 0),
                      )
                    : currency.format(shipment.totalAmount)}
                </TableCell>
                {editing && <TableCell />}
              </TableRow>
            </TableBody>
          </Table>
        </div>
        {editing && availableToAdd.length > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <Select value={addProductId} onValueChange={setAddProductId}>
              <SelectTrigger className="w-64" data-testid="select-add-product">
                <SelectValue placeholder="Добавить товар из заказа" />
              </SelectTrigger>
              <SelectContent>
                {availableToAdd.map((oi) => (
                  <SelectItem key={oi.productId} value={oi.productId}>
                    {oi.productName} (остаток {oi.remainingQuantity})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={addProduct}
              disabled={!addProductId}
              data-testid="button-add-shipment-item"
            >
              Добавить
            </Button>
          </div>
        )}
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Пометить отгрузку на удаление</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Отгрузка №{shipment.id.slice(0, 8)} будет помечена как удалённая, товар вернётся на склад.
              Редактирование будет недоступно — при необходимости создайте новую отгрузку. Действие нельзя отменить.
            </p>
            <div className="space-y-2">
              <Label htmlFor="deleteNoteDetail">Причина удаления (обязательно)</Label>
              <Textarea
                id="deleteNoteDetail"
                required
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                data-testid="input-shipment-delete-note-detail"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={!deleteNote.trim() || deleteShipment.isPending}
              data-testid="button-confirm-delete-shipment-detail"
            >
              Пометить на удаление
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
