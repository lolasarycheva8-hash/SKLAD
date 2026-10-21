type AlreadyDeletedDeliveryActions = {
  invalidate: () => void;
  closeStaleDialog: () => void;
  notify: (notice: { title: string; description: string }) => void;
};

function isDeliveryAlreadyDeletedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }

  return error.status === 404;
}

export function handleAlreadyDeletedDelivery(
  error: unknown,
  actions: AlreadyDeletedDeliveryActions,
): boolean {
  if (!isDeliveryAlreadyDeletedError(error)) return false;

  actions.invalidate();
  actions.closeStaleDialog();
  actions.notify({
    title: "Доставка уже удалена",
    description: "Список обновлён: запись удалил другой администратор.",
  });
  return true;
}