export type OrderStatus = "draft" | "shipped" | "delivered" | "awaiting_payment" | "paid";

export function orderNumber(id: string): string {
  // Full UUID avoids collisions and remains stable for all historical rows.
  return `З-${id}`;
}

export function resolveOrderStatus(input: {
  isPaid: boolean;
  summary?: { paidAt: Date | null } | null;
  actualDate?: string | null;
  activePhoto: boolean;
  activeDelivery: boolean;
  shipped: boolean;
}): OrderStatus {
  if (input.summary) return input.summary.paidAt ? "paid" : "awaiting_payment";
  if (input.isPaid) return "paid";
  if (input.activeDelivery && input.actualDate && input.activePhoto) return "delivered";
  return input.shipped ? "shipped" : "draft";
}

export function validBillingPeriod(from: string, to: string): boolean {
  const month = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/;
  return month.test(from) && month.test(to) && from <= to;
}

export type BillingLine = {
  productId: string; productName: string; unit: string;
  quantity: number; price: number; total: number;
};

export function groupBillingLines(lines: Omit<BillingLine, "total">[]): BillingLine[] {
  const grouped = new Map<string, BillingLine>();
  for (const line of lines) {
    const key = JSON.stringify([line.productId, line.price]);
    const existing = grouped.get(key);
    if (existing) existing.quantity += line.quantity;
    else grouped.set(key, { ...line, total: 0 });
  }
  return [...grouped.values()].map((line) => ({
    ...line, quantity: Math.round(line.quantity * 100) / 100,
    total: Math.round(line.quantity * line.price * 100) / 100,
  })).sort((a, b) => a.productId.localeCompare(b.productId) || a.price - b.price);
}