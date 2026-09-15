import { useEffect, useMemo, useState } from "react";
import {
  useCreateAdditionalDeliveryOrder,
  useListDeliveryTypes,
  useListOrderProductLookup,
} from "@workspace/api-client-react";
import type { Delivery } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  EMPTY_ORDER_FORM_ITEM,
  OrderFormFields,
  type OrderFormItem,
} from "@/components/order-form-fields";

export type AdditionalOrderDelivery = Delivery;

function newRequestId(): string {
  const browserCrypto =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (browserCrypto && typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  if (browserCrypto && typeof browserCrypto.getRandomValues === "function") {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 version 4 / variant 1.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error(
    "Безопасный генератор UUID недоступен — дополнительный заказ нельзя создать",
  );
}

function sourceItems(
  delivery: AdditionalOrderDelivery,
  products: Array<{ id: string; price: number }>,
): OrderFormItem[] {
  const additionalItems = delivery.additionalOrderItems ?? [];
  if (additionalItems.length > 0) {
    return additionalItems.map((item) => ({
      productId: item.productId,
      quantity: String(item.quantity),
      price: String(
        products.find((product) => product.id === item.productId)?.price ?? 0,
      ),
    }));
  }

  return [{ ...EMPTY_ORDER_FORM_ITEM }];
}

export function AdditionalOrderDialog({
  delivery,
  open,
  onCancel,
  onSuccess,
}: {
  delivery: AdditionalOrderDelivery;
  open: boolean;
  onCancel: () => void;
  onSuccess: (result: { orderId: string; deliveryId: string }) => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<OrderFormItem[]>([
    { ...EMPTY_ORDER_FORM_ITEM },
  ]);
  const [note, setNote] = useState("");
  const [deliveryType, setDeliveryType] = useState("");
  const [step, setStep] = useState<"type" | "order">("type");
  const [requestId, setRequestId] = useState(() => newRequestId());
  const [initializedSourceId, setInitializedSourceId] = useState<string | null>(
    null,
  );
  const [isPending, setIsPending] = useState(false);

  const { data: deliveryTypes, isError: deliveryTypesError } =
    useListDeliveryTypes();
  const {
    data: products,
    isLoading: productsLoading,
    isError: productsError,
    isFetching: productsFetching,
    refetch: refetchProducts,
  } = useListOrderProductLookup();
  const createAdditionalOrder = useCreateAdditionalDeliveryOrder();

  const productRows = products ?? [];

  useEffect(() => {
    if (!open || initializedSourceId === delivery.id) return;

    setInitializedSourceId(delivery.id);
    setRequestId(newRequestId());
    setStep("type");
    setDeliveryType("");
    setNote("");
    setItems(sourceItems(delivery, productRows));
  }, [delivery, initializedSourceId, open, productRows]);

  const clientName = delivery.clientName ?? "—";
  const sourceDeliveryType = delivery.deliveryType ?? "";
  const itemsLoaded = useMemo(
    () => items.some((item) => Boolean(item.productId)),
    [items],
  );
  const productsUnavailable = productsLoading || productsError || !products;

  function updateItem(index: number, patch: Partial<OrderFormItem>) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function handleProductSelect(index: number, productId: string) {
    const product = productRows.find((candidate) => candidate.id === productId);
    updateItem(index, {
      productId,
      price: product ? String(product.price) : "0",
    });
  }

  function handleCancel() {
    if (isPending) return;
    onCancel();
  }

  function handleTypeContinue() {
    if (!deliveryType) return;
    if (sourceDeliveryType && deliveryType === sourceDeliveryType) {
      toast({
        title: "Выберите другой тип поставки",
        variant: "destructive",
      });
      return;
    }
    setStep("order");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending) return;

    if (items.some((item) =>
      !item.productId || !Number.isFinite(Number(item.quantity)) ||
      Number(item.quantity) <= 0
    )) {
      toast({
        title: "Заполните все позиции заказа",
        description: "Выберите товар и укажите количество либо удалите пустую позицию.",
        variant: "destructive",
      });
      return;
    }

    const requestItems = items
      .filter((item) => item.productId && Number(item.quantity) > 0)
      .map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        price: Number(item.price) || 0,
      }));
    if (requestItems.length === 0) {
      toast({
        title: "Добавьте хотя бы одну позицию",
        variant: "destructive",
      });
      return;
    }
    if (!deliveryType) {
      toast({
        title: "Выберите тип поставки",
        variant: "destructive",
      });
      return;
    }
    if (sourceDeliveryType && deliveryType === sourceDeliveryType) {
      toast({
        title: "Выберите другой тип поставки",
        variant: "destructive",
      });
      return;
    }

    setIsPending(true);
    try {
      const result = await createAdditionalOrder.mutateAsync({
        id: delivery.id,
        data: {
          deliveryType,
          note: note.trim() || undefined,
          items: requestItems,
          requestId,
        },
      });
      // A successful operation must never be retried with the old id.
      setRequestId(newRequestId());
      onSuccess(result);
    } catch (error) {
      toast({
        title: "Не удалось сохранить дополнительный заказ",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleCancel();
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Новый заказ — ДОП.ЗАКАЗ</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {step === "type" ? (
            <>
              <div className="space-y-2">
                <Label>Исходный объект</Label>
                <Input
                  value={delivery.siteName}
                  readOnly
                  disabled
                  data-testid="input-order-locked-source"
                />
              </div>
              <div className="space-y-2">
                <Label>Клиент</Label>
                <Input
                  value={clientName}
                  readOnly
                  disabled
                  data-testid="input-order-locked-client"
                />
              </div>
              <div className="space-y-2">
                <Label>Тип поставки</Label>
                <Select
                  value={deliveryType}
                  onValueChange={setDeliveryType}
                  disabled={isPending}
                  required
                >
                  <SelectTrigger data-testid="select-additional-order-delivery-type">
                    <SelectValue placeholder="Выберите тип поставки" />
                  </SelectTrigger>
                  <SelectContent>
                    {(deliveryTypes ?? []).map((type) => (
                      <SelectItem key={type.id} value={type.name}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sourceDeliveryType && (
                  <p className="text-xs text-muted-foreground">
                    Исходный тип: {sourceDeliveryType}. Выберите другой тип из
                    справочника.
                  </p>
                )}
              </div>
              {deliveryTypesError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Не удалось загрузить справочник типов поставки.
                  </AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isPending}
                  data-testid="button-cancel-additional-order"
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  onClick={handleTypeContinue}
                  disabled={isPending || !deliveryType}
                  data-testid="button-continue-additional-order"
                >
                  Далее: Новый заказ
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <span className="text-muted-foreground">Тип поставки: </span>
                <span className="font-medium">{deliveryType}</span>
              </div>
              <OrderFormFields
                clients={[]}
                products={productRows}
                clientId={delivery.clientId ?? ""}
                onClientChange={() => undefined}
                clientLockedName={clientName}
                sourceLabel={delivery.siteName}
                items={items}
                onItemChange={updateItem}
                onProductSelect={handleProductSelect}
                onAddItem={() =>
                  setItems((current) => [
                    ...current,
                    { ...EMPTY_ORDER_FORM_ITEM },
                  ])
                }
                onRemoveItem={(index) =>
                  setItems((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                note={note}
                onNoteChange={setNote}
                noteId="additional-order-note"
                productTestIdPrefix="additional-order"
                hidePrices
              />
              {productsLoading || (!products && !productsError) ? (
                <p className="text-sm text-muted-foreground">
                  Загружаем каталог товаров…
                </p>
              ) : null}
              {productsError && (
                <Alert variant="destructive">
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Не удалось загрузить каталог товаров. Сохранение
                      отключено до успешной повторной загрузки.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void refetchProducts()}
                      disabled={productsFetching}
                      data-testid="button-retry-additional-order-products"
                    >
                      {productsFetching ? "Загрузка…" : "Повторить"}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isPending}
                  data-testid="button-cancel-additional-order"
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={isPending || productsUnavailable || !itemsLoaded}
                  data-testid="button-save-additional-order"
                >
                  {isPending ? "Сохранение…" : "Сохранить дополнительный заказ"}
                </Button>
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}