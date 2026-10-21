export type AdditionalOrderMatrixDelivery = {
  id: string;
  siteId: string;
  siteName: string;
  driver: string;
  siteClient: string;
  parentDeliveryId?: string | null;
  orderId?: string | null;
  hasAdditionalOrders?: boolean;
};

export type AdditionalOrderMatrixRow<
  T extends AdditionalOrderMatrixDelivery = AdditionalOrderMatrixDelivery,
> = {
  key: string;
  siteId: string;
  siteName: string;
  driver: string;
  client: string;
  deliveries: T[];
  hasAdditionalOrder: boolean;
  additionalOrderDeliveries: T[];
};

function isAdditionalChild(delivery: AdditionalOrderMatrixDelivery): boolean {
  return Boolean(
    delivery.parentDeliveryId ||
      (delivery.orderId && !delivery.hasAdditionalOrders),
  );
}

export function buildAdditionalOrderMatrixRows<
  T extends AdditionalOrderMatrixDelivery,
>(scheduleDeliveries: readonly T[]): AdditionalOrderMatrixRow<T>[] {
  const map = new Map<string, AdditionalOrderMatrixRow<T>>();

  for (const delivery of scheduleDeliveries) {
    const key = `${delivery.siteId}-${delivery.driver}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        siteId: delivery.siteId,
        siteName: delivery.siteName,
        driver: delivery.driver,
        client: delivery.siteClient,
        deliveries: [],
        hasAdditionalOrder: false,
        additionalOrderDeliveries: [],
      });
    }

    const row = map.get(key)!;
    row.deliveries.push(delivery);
    row.hasAdditionalOrder =
      row.hasAdditionalOrder ||
      isAdditionalChild(delivery);
    if (isAdditionalChild(delivery)) {
      row.additionalOrderDeliveries.push(delivery);
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.siteName.localeCompare(b.siteName),
  );
}