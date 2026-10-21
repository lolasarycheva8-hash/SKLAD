import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderSitePicker } from "@/components/order-site-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type OrderFormItem = {
  productId: string;
  quantity: string;
  price: string;
};

export type OrderFormClient = {
  id: string;
  name: string;
};

export type OrderFormProduct = {
  id: string;
  name: string;
  unit: string;
  price: number;
};

export type OrderFormSite = {
  id: string;
  name: string;
  address: string;
  clientId: string;
};

export function filterOrderSitesForClient(
  sites: OrderFormSite[],
  clientId: string,
) {
  return sites.filter((site) => site.clientId === clientId);
}

export function copiedOrderSiteSelection(
  sourceSiteId: string | null | undefined,
  clientId: string,
  sites: OrderFormSite[],
) {
  if (!sourceSiteId) return "__none__";
  return sites.some(
    (site) => site.id === sourceSiteId && site.clientId === clientId,
  )
    ? sourceSiteId
    : "";
}

export function siteSelectionAfterClientChange(
  currentSiteId: string,
  nextClientId: string,
  sites: OrderFormSite[],
) {
  if (!currentSiteId || currentSiteId === "__none__") return currentSiteId;
  return sites.some(
    (site) => site.id === currentSiteId && site.clientId === nextClientId,
  )
    ? currentSiteId
    : "";
}

export function orderSiteIdForRequest(selection: string): string | null {
  return selection === "__none__" ? null : selection;
}

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export const EMPTY_ORDER_FORM_ITEM: OrderFormItem = {
  productId: "",
  quantity: "1",
  price: "0",
};

/**
 * Shared order fields used by the regular order dialog and additional-order
 * dialog. Keeping the line-item editor here prevents the two flows from
 * drifting apart (in particular around product pricing and quantity input).
 */
export function OrderFormFields({
  clients,
  products,
  clientId,
  onClientChange,
  clientLockedName,
  items,
  onItemChange,
  onProductSelect,
  onAddItem,
  onRemoveItem,
  note,
  onNoteChange,
  noteId = "note",
  productTestIdPrefix = "order",
  hidePrices = false,
  sourceLabel,
  sites,
  siteId,
  onSiteChange,
  sitesLoading = false,
  sitesError = false,
}: {
  clients: OrderFormClient[];
  products: OrderFormProduct[];
  clientId: string;
  onClientChange: (value: string) => void;
  clientLockedName?: string;
  items: OrderFormItem[];
  onItemChange: (index: number, patch: Partial<OrderFormItem>) => void;
  onProductSelect: (index: number, productId: string) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  note: string;
  onNoteChange: (value: string) => void;
  noteId?: string;
  productTestIdPrefix?: string;
  hidePrices?: boolean;
  sourceLabel?: string;
  sites?: OrderFormSite[];
  siteId?: string;
  onSiteChange?: (value: string) => void;
  sitesLoading?: boolean;
  sitesError?: boolean;
}) {
  const totalPreview = items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    return sum + qty * price;
  }, 0);

  return (
    <>
      {sites && onSiteChange && (
        <div className="space-y-2">
          <Label>Магазин и адрес</Label>
          <OrderSitePicker
            sites={sites}
            value={siteId}
            onChange={(value) => {
              const site = sites.find((item) => item.id === value);
              onClientChange(site?.clientId ?? "");
              onSiteChange(value);
            }}
            loading={sitesLoading}
            error={sitesError}
          />
          {sitesError && (
            <p className="text-sm text-destructive" role="alert">
              Не удалось загрузить магазины. Обновите страницу и повторите попытку.
            </p>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label>Клиент (юрлицо)</Label>
        {clientLockedName ? (
          <Input
            value={clientLockedName}
            readOnly
            disabled
            data-testid="input-order-locked-client"
          />
        ) : sites && siteId && siteId !== "__none__" ? (
          <>
            <Input
              value={clients.find((client) => client.id === clientId)?.name ?? ""}
              placeholder="Загрузка юрлица…"
              readOnly
              data-testid="input-order-auto-client"
            />
            <p className="text-xs text-muted-foreground">Подставлено из карточки магазина</p>
          </>
        ) : (
          <Select value={clientId} onValueChange={onClientChange} required disabled={!!sites && !siteId}>
            <SelectTrigger data-testid="select-order-client">
              <SelectValue placeholder="Выберите клиента" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {sourceLabel && (
        <div className="space-y-2">
          <Label>Исходный объект</Label>
          <Input
            value={sourceLabel}
            readOnly
            disabled
            data-testid="input-order-locked-source"
          />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Позиции заказа</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddItem}
            data-testid={`button-add-${productTestIdPrefix}-item`}
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
                onValueChange={(value) => onProductSelect(index, value)}
              >
                <SelectTrigger
                  className="flex-1"
                  data-testid={`select-${productTestIdPrefix}-item-product-${index}`}
                >
                  <SelectValue placeholder="Товар" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
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
                onChange={(event) =>
                  onItemChange(index, { quantity: event.target.value })
                }
                data-testid={`input-${productTestIdPrefix}-item-quantity-${index}`}
              />
              {!hidePrices && (
                <Input
                  type="number"
                  className="w-28"
                  placeholder="Цена"
                  value={item.price}
                  readOnly
                  disabled
                  title="Цена подтягивается из справочника товаров"
                  data-testid={`input-${productTestIdPrefix}-item-price-${index}`}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemoveItem(index)}
                disabled={items.length === 1}
                data-testid={`button-remove-${productTestIdPrefix}-item-${index}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
        {!hidePrices && (
          <div className="text-sm text-muted-foreground text-right">
            Итого:{" "}
            <span className="font-medium text-foreground">
              {currency.format(totalPreview)}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={noteId}>Примечание</Label>
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          data-testid="input-order-note"
        />
      </div>
    </>
  );
}