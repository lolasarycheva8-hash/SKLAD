import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  useUpdateOrder,
  useDeleteOrder,
  useCreateOrder,
  useListShipmentSiteLookup,
  useListDrivers,
  useListOrderShipmentLookup,
  useCreateShipment,
  useListOrderProductLookup,
  useListOrderPayments,
  useCreateOrderPayment,
  getGetOrderQueryKey,
  getListOrderShipmentLookupQueryKey,
  getListOrdersQueryKey,
  getListOrderPaymentsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Printer, Trash2, Copy, ExternalLink, Pencil, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

type ShipmentItemRow = {
  productId: string;
  quantity: string;
};

type OrderItemRow = {
  productId: string;
  quantity: string;
  price: string;
};

export default function OrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = params.id!;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditOrders = canEdit("orders");
  const canEditShipments = canEdit("shipments");

  const { data: order, isLoading } = useGetOrder(orderId);
  const { data: sites } = useListShipmentSiteLookup();
  const { data: drivers = [] } = useListDrivers();
  const { data: shipments } = useListOrderShipmentLookup(orderId);
  const { data: products } = useListOrderProductLookup();
  const { data: payments } = useListOrderPayments(orderId);

  const [editingItems, setEditingItems] = useState(false);
  const [itemRows, setItemRows] = useState<OrderItemRow[]>([]);

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const [shipDialogOpen, setShipDialogOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [driver, setDriver] = useState("");
  const [driverTouched, setDriverTouched] = useState(false);
  const [shipmentDate, setShipmentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [shipItems, setShipItems] = useState<ShipmentItemRow[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (driverTouched) return;
    const site = (sites ?? []).find((s) => s.id === siteId);
    if (site) setDriver(site.driverUserId ?? "");
  }, [siteId, sites, driverTouched]);

  const invalidateOrder = () => {
    queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
  };
  const invalidateShipments = () => {
    queryClient.invalidateQueries({ queryKey: getListOrderShipmentLookupQueryKey(orderId) });
  };
  const invalidatePayments = () => {
    queryClient.invalidateQueries({ queryKey: getListOrderPaymentsQueryKey(orderId) });
  };

  const createPayment = useCreateOrderPayment({
    mutation: {
      onSuccess: () => {
        invalidateOrder();
        invalidatePayments();
        setPaymentDialogOpen(false);
        setPaymentAmount("");
        setPaymentNote("");
        toast({ title: "Платёж добавлен" });
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

  function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Укажите сумму платежа", variant: "destructive" });
      return;
    }
    createPayment.mutate({ id: orderId, data: { amount, note: paymentNote || undefined } });
  }

  const updateOrder = useUpdateOrder({
    mutation: {
      onSuccess: () => {
        invalidateOrder();
        toast({ title: "Заказ обновлён" });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  const deleteOrder = useDeleteOrder({
    mutation: {
      onSuccess: () => {
        toast({ title: "Заказ удалён" });
        navigate("/orders");
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
        setDeleteConfirmOpen(false);
      },
    },
  });

  const createShipment = useCreateShipment({
    mutation: {
      onSuccess: (data) => {
        invalidateOrder();
        invalidateShipments();
        setShipDialogOpen(false);
        toast({ title: "Отгрузка создана" });
        navigate(`/shipments/${data.id}`);
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

  const copyOrder = useCreateOrder({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        toast({ title: "Заказ скопирован" });
        navigate(`/orders/${data.id}`);
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  function handleCopyOrder() {
    if (!order) return;
    copyOrder.mutate({
      data: {
        clientId: order.clientId,
        note: order.note ?? undefined,
        items: order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
        })),
      },
    });
  }

  function openEditItems() {
    if (!order) return;
    setItemRows(
      order.items.map((item) => {
        const product = (products ?? []).find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          quantity: String(item.quantity),
          price: product ? String(product.price) : String(item.price),
        };
      }),
    );
    setEditingItems(true);
  }

  function cancelEditItems() {
    setEditingItems(false);
    setItemRows([]);
  }

  function updateItemRow(index: number, patch: Partial<OrderItemRow>) {
    setItemRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleProductSelectRow(index: number, productId: string) {
    const product = (products ?? []).find((p) => p.id === productId);
    updateItemRow(index, { productId, price: product ? String(product.price) : "0" });
  }

  function addItemRow() {
    setItemRows((prev) => [...prev, { productId: "", quantity: "1", price: "0" }]);
  }

  function removeItemRow(index: number) {
    setItemRows((prev) => prev.filter((_, i) => i !== index));
  }

  function saveItems() {
    const validItems = itemRows.filter((item) => item.productId && Number(item.quantity) > 0);
    if (validItems.length === 0) {
      toast({ title: "Добавьте хотя бы одну позицию", variant: "destructive" });
      return;
    }
    updateOrder.mutate(
      {
        id: orderId,
        data: {
          items: validItems.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
            price: Number(item.price),
          })),
        },
      },
      {
        onSuccess: () => {
          setEditingItems(false);
          setItemRows([]);
        },
      },
    );
  }

  function openShipDialog() {
    setSiteId("");
    setDriver("");
    setDriverTouched(false);
    setShipmentDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setShipItems(
      (order?.items ?? [])
        .filter((item) => item.remainingQuantity > 0)
        .map((item) => ({ productId: item.productId, quantity: String(item.remainingQuantity) })),
    );
    setShipDialogOpen(true);
  }

  function updateShipItem(productId: string, quantity: string) {
    setShipItems((prev) => prev.map((item) => (item.productId === productId ? { ...item, quantity } : item)));
  }

  function handleCreateShipment(e: React.FormEvent) {
    e.preventDefault();
    const validItems = shipItems.filter((item) => Number(item.quantity) > 0);
    if (validItems.length === 0) {
      toast({ title: "Укажите количество для отгрузки", variant: "destructive" });
      return;
    }

    createShipment.mutate({
      data: {
        orderId,
        siteId,
        driverUserId: driver || null,
        shipmentDate,
        note: note || undefined,
        items: validItems.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
      },
    });
  }

  if (isLoading || !order) {
    return <div className="text-muted-foreground">Загрузка...</div>;
  }

  const hasRemaining = order.items.some((item) => item.remainingQuantity > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full" data-testid="text-page-title">
        Заказ: {order.clientName}
      </h1>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/orders">
            <Button variant="ghost" size="icon" data-testid="button-back-to-orders">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-muted-foreground text-sm">
            Создан {dateFormatter.format(new Date(order.createdAt))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            {order.isPaid ? (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100" variant="outline">
                Оплачен
              </Badge>
            ) : (
              <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100" variant="outline">
                Ожидается оплата
              </Badge>
            )}
            {order.overpaidAmount > 0 && (
              <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100" variant="outline">
                Переплата {currency.format(order.overpaidAmount)}
              </Badge>
            )}
          </div>
          {canEditOrders && (
            <Button
              variant="outline"
              onClick={() => setPaymentDialogOpen(true)}
              data-testid="button-add-payment"
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить платёж
            </Button>
          )}
          <Link href={`/orders/${orderId}/print`}>
            <Button variant="outline" data-testid="button-print-order">
              <Printer className="h-4 w-4 mr-2" />
              Печать заказа
            </Button>
          </Link>
          {canEditShipments && (
            <Button
              onClick={openShipDialog}
              disabled={!order.isPaid || !hasRemaining}
              data-testid="button-add-shipment"
            >
              <Plus className="h-4 w-4 mr-2" />
              Создать доставку
            </Button>
          )}
          {canEditOrders && (
            <Button
              variant="outline"
              onClick={handleCopyOrder}
              disabled={copyOrder.isPending}
              data-testid="button-copy-order"
            >
              <Copy className="h-4 w-4 mr-2" />
              Копировать заказ
            </Button>
          )}
          {canEditOrders && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDeleteConfirmOpen(true)}
              data-testid="button-delete-order"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {!order.isPaid && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-sm px-4 py-2">
          Заказ не оплачен — отгрузка недоступна, пока заказ не будет отмечен как оплаченный.
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Позиции заказа</h2>
          {canEditOrders && !editingItems && !order.isPaid && (
            <Button variant="outline" size="sm" onClick={openEditItems} data-testid="button-edit-order-items">
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Редактировать позиции
            </Button>
          )}
          {canEditOrders && order.isPaid && (
            <span className="text-xs text-muted-foreground">
              Заказ оплачен — состав нельзя изменить
            </span>
          )}
        </div>
        {editingItems ? (
          <div className="space-y-3">
            <div className="space-y-2">
              {itemRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select value={row.productId} onValueChange={(value) => handleProductSelectRow(index, value)}>
                    <SelectTrigger className="flex-1" data-testid={`select-edit-order-item-product-${index}`}>
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
                    value={row.quantity}
                    onChange={(e) => updateItemRow(index, { quantity: e.target.value })}
                    data-testid={`input-edit-order-item-quantity-${index}`}
                  />
                  <Input
                    type="number"
                    className="w-28"
                    placeholder="Цена"
                    value={row.price}
                    readOnly
                    disabled
                    title="Цена подтягивается из справочника товаров"
                    data-testid={`input-edit-order-item-price-${index}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItemRow(index)}
                    disabled={itemRows.length === 1}
                    data-testid={`button-remove-edit-order-item-${index}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={addItemRow} data-testid="button-add-edit-order-item">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Добавить позицию
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelEditItems}
                  data-testid="button-cancel-edit-order-items"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Отмена
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={saveItems}
                  disabled={updateOrder.isPending}
                  data-testid="button-save-order-items"
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Сохранить
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border rounded-md overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Товар</TableHead>
                  <TableHead className="text-right">Заказано</TableHead>
                  <TableHead className="text-right">Отгружено</TableHead>
                  <TableHead className="text-right">Остаток</TableHead>
                  <TableHead className="text-right">Цена</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id} data-testid={`row-order-item-${item.id}`}>
                    <TableCell className="font-medium py-1.5">{item.productName}</TableCell>
                    <TableCell className="text-right py-1.5">{item.quantity}</TableCell>
                    <TableCell className="text-right py-1.5">{item.shippedQuantity}</TableCell>
                    <TableCell className="text-right py-1.5">
                      {item.remainingQuantity > 0 ? (
                        item.remainingQuantity
                      ) : (
                        <Badge variant="default">Отгружено полностью</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right py-1.5">{currency.format(item.price)}</TableCell>
                    <TableCell className="text-right py-1.5">{currency.format(item.price * item.quantity)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-medium py-1.5">
                    Итого
                  </TableCell>
                  <TableCell className="text-right font-medium py-1.5">{currency.format(order.totalAmount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Платежи</h2>
        <div className="border rounded-md overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Примечание</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(payments ?? []).length > 0 ? (
                (payments ?? []).map((payment) => (
                  <TableRow key={payment.id} data-testid={`row-payment-${payment.id}`}>
                    <TableCell className="py-1.5">{dateFormatter.format(new Date(payment.createdAt))}</TableCell>
                    <TableCell className="py-1.5 text-muted-foreground">{payment.note || "—"}</TableCell>
                    <TableCell className="text-right py-1.5">{currency.format(payment.amount)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    Платежей пока нет
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell colSpan={2} className="text-right font-medium py-1.5">
                  Оплачено / Заказано
                </TableCell>
                <TableCell className="text-right font-medium py-1.5">
                  {currency.format(order.paidAmount)} / {currency.format(order.totalAmount)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Отгрузки</h2>
        <div className="border rounded-md overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Объект</TableHead>
                <TableHead>Водитель</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(shipments ?? []).length > 0 ? (
                (shipments ?? []).map((shipment) => (
                  <TableRow key={shipment.id} data-testid={`row-shipment-${shipment.id}`}>
                    <TableCell className="py-1.5">{shipment.siteName}</TableCell>
                    <TableCell className="py-1.5">{shipment.driver}</TableCell>
                    <TableCell className="py-1.5">{dateFormatter.format(new Date(shipment.shipmentDate))}</TableCell>
                    <TableCell className="text-right py-1.5">{currency.format(shipment.totalAmount)}</TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex items-center gap-1">
                        <Link href={`/shipments/${shipment.id}`}>
                          <Button variant="outline" size="icon" title="Открыть" data-testid={`button-open-shipment-${shipment.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        {canEditShipments && (
                          <Link href={`/shipments?copyFrom=${shipment.id}`}>
                            <Button variant="outline" size="icon" title="Копировать отгрузку" data-testid={`button-copy-shipment-${shipment.id}`}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        )}
                        {shipment.isDispatched && !shipment.isDeleted && (
                          <Link href={`/shipments/${shipment.id}/print`}>
                            <Button variant="outline" size="sm" data-testid={`button-print-shipment-${shipment.id}`}>
                              <Printer className="h-3.5 w-3.5 mr-1" />
                              Накладная
                            </Button>
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Отгрузок пока нет
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={shipDialogOpen} onOpenChange={setShipDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новая отгрузка</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateShipment} className="space-y-4">
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

            <div className="space-y-2">
              <Label>Позиции к отгрузке</Label>
              <div className="space-y-2">
                {order.items
                  .filter((item) => item.remainingQuantity > 0)
                  .map((item) => {
                    const row = shipItems.find((r) => r.productId === item.productId);
                    return (
                      <div key={item.id} className="flex items-center gap-2">
                        <div className="flex-1 text-sm">
                          {item.productName}{" "}
                          <span className="text-muted-foreground">(остаток: {item.remainingQuantity})</span>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max={item.remainingQuantity}
                          step="0.01"
                          className="w-28"
                          value={row?.quantity ?? "0"}
                          onChange={(e) => updateShipItem(item.productId, e.target.value)}
                          data-testid={`input-shipment-item-quantity-${item.productId}`}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>

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
                disabled={createShipment.isPending || !siteId}
                data-testid="button-save-shipment"
              >
                Создать отгрузку
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить платёж</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddPayment} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="paymentAmount">Сумма</Label>
              <Input
                id="paymentAmount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                data-testid="input-payment-amount"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentNote">Примечание</Label>
              <Textarea
                id="paymentNote"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="Аванс, доплата и т.п."
                data-testid="input-payment-note"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createPayment.isPending} data-testid="button-save-payment">
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заказ?</AlertDialogTitle>
            <AlertDialogDescription>
              Заказ будет удалён без возможности восстановления. Заказы с отгрузками удалить нельзя.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-order">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteOrder.mutate({ id: orderId })}
              data-testid="button-confirm-delete-order"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
