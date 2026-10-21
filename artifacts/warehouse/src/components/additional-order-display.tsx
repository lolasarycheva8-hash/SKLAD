import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

export type AdditionalOrderDisplayItem = {
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
};

export function standardDeliveryLabel(deliveryType?: string | null): string | null {
  switch (deliveryType?.trim().toLocaleLowerCase("ru")) {
    case "закрытие": return "ВЫВОЗ";
    case "открывашка": return "ОТКРЫВАШКА";
    case "отмывка": return "ОТМЫВКА";
    default: return null;
  }
}

export function isAdditionalDelivery(delivery: {
  parentDeliveryId?: string | null;
  orderId?: string | null;
  hasAdditionalOrders?: boolean;
}) {
  return Boolean(
    delivery.parentDeliveryId ||
      (delivery.orderId && !delivery.hasAdditionalOrders),
  );
}

export function AdditionalOrderLabel({
  delivery,
  canViewOrders,
}: {
  delivery: {
    orderId?: string | null;
    parentDeliveryId?: string | null;
    hasAdditionalOrders?: boolean;
    deliveryType?: string | null;
  };
  canViewOrders?: boolean;
}) {
  const serviceLabel = standardDeliveryLabel(delivery.deliveryType);
  if (!serviceLabel && !isAdditionalDelivery(delivery)) return null;

  const label = (
    <Badge
      variant="secondary"
      className="w-fit border-amber-300 bg-amber-100 px-1.5 py-0 text-[10px] font-bold text-amber-900"
      data-testid="badge-additional-order"
    >
      {serviceLabel ?? (delivery.deliveryType?.trim().toLocaleUpperCase("ru") || "ДОП.ЗАКАЗ")}
    </Badge>
  );

  if (delivery.orderId && canViewOrders) {
    return (
      <Link
        href={`/orders/${delivery.orderId}`}
        className="inline-flex hover:opacity-80"
        title="Открыть заказ"
        data-testid="link-additional-order"
      >
        {label}
      </Link>
    );
  }

  return label;
}

export function AdditionalOrderItems({
  items,
  compact = false,
}: {
  items?: AdditionalOrderDisplayItem[] | null;
  compact?: boolean;
}) {
  if (!items || items.length === 0) return null;

  return (
    <div
      className={compact ? "text-[11px] leading-tight" : "text-xs leading-snug"}
      data-testid="additional-order-items"
    >
      <span className="font-semibold">Товары: </span>
      {items
        .map((item) => `${item.productName} — ${item.quantity} ${item.unit}`)
        .join(", ")}
    </div>
  );
}