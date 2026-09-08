type DeliveryActor = {
  id: string;
  isDriver: boolean;
  role: string;
  editableSections: readonly string[];
};

export const DELIVERY_ACT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isDateInPlannedMonth(
  plannedDate: string | null,
  actualDate: string,
  scheduleMonth?: string | null,
): boolean {
  const effectiveMonth = scheduleMonth ?? plannedDate?.slice(0, 7);
  return effectiveMonth !== undefined && actualDate.slice(0, 7) === effectiveMonth;
}

export function canEditDeliveries(user?: DeliveryActor | null): boolean {
  return (
    user?.role === "admin" ||
    (user?.role === "logistician" &&
      user.editableSections.includes("deliveries"))
  );
}

export function canApproveDeliveryActs(user?: DeliveryActor | null): boolean {
  return (
    canEditDeliveries(user) ||
    (user?.role === "manager" &&
      user.editableSections.includes("deliveries"))
  );
}

export function canUploadDeliveryActs(
  user: DeliveryActor | null | undefined,
  deliveryDriverUserId: string | null,
): boolean {
  return (
    canEditDeliveries(user) ||
    ((user?.role === "driver" || !!user?.isDriver) &&
      user.id === deliveryDriverUserId)
  );
}

export function canAccessDeliveryActs(
  user: DeliveryActor | null | undefined,
  deliveryDriverUserId: string | null,
): boolean {
  return (
    canApproveDeliveryActs(user) ||
    canUploadDeliveryActs(user, deliveryDriverUserId)
  );
}

export function isUploadObjectPath(objectPath: string): boolean {
  return /^\/objects\/uploads\/[A-Za-z0-9_-]+$/.test(objectPath);
}

export function isAllowedDeliveryActMimeType(mimeType: string): boolean {
  return DELIVERY_ACT_MIME_TYPES.has(mimeType);
}

export function isDeliveryActAlreadyAttached(
  existing: { id: string } | undefined,
): boolean {
  return existing !== undefined;
}