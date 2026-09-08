import assert from "node:assert/strict";
import test from "node:test";

import {
  canApproveDeliveryActs,
  canAccessDeliveryActs,
  canEditDeliveries,
  canUploadDeliveryActs,
  isAllowedDeliveryActMimeType,
  isDateInPlannedMonth,
  isDeliveryActAlreadyAttached,
  isUploadObjectPath,
} from "./delivery-acts.ts";
import {
  normalizeInvitedUserRole,
  normalizeUserRole,
} from "./user-roles.ts";

test("фактическая дата разрешена только в месяце плановой даты", () => {
  assert.equal(isDateInPlannedMonth("2026-09-05", "2026-09-01"), true);
  assert.equal(isDateInPlannedMonth("2026-09-05", "2026-09-30"), true);
  assert.equal(isDateInPlannedMonth("2026-09-05", "2026-08-31"), false);
  assert.equal(isDateInPlannedMonth("2026-09-05", "2026-10-01"), false);
});

test("для доставки без даты используется месяц графика", () => {
  assert.equal(isDateInPlannedMonth(null, "2026-09-12", "2026-09"), true);
  assert.equal(isDateInPlannedMonth(null, "2026-10-01", "2026-09"), false);
  assert.equal(isDateInPlannedMonth(null, "2026-09-12"), false);
});

test("логист доставок и назначенный водитель видят акты", () => {
  const driverUserId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    canAccessDeliveryActs(
      { id: "logistician", isDriver: false, role: "logistician", editableSections: ["deliveries"] },
      driverUserId,
    ),
    true,
  );
  assert.equal(
    canAccessDeliveryActs(
      { id: driverUserId, isDriver: false, role: "driver", editableSections: [] },
      driverUserId,
    ),
    true,
  );
});

test("чужой водитель и обычный пользователь не видят акты", () => {
  assert.equal(
    canAccessDeliveryActs(
      { id: "22222222-2222-4222-8222-222222222222", isDriver: false, role: "driver", editableSections: [] },
      "11111111-1111-4111-8111-111111111111",
    ),
    false,
  );
  assert.equal(
    canAccessDeliveryActs(
      { id: "manager", isDriver: false, role: "manager", editableSections: [] },
      "11111111-1111-4111-8111-111111111111",
    ),
    false,
  );
});

test("водитель не может удалить акт, если у него нет права редактировать доставки", () => {
  const assignedDriver = {
    id: "11111111-1111-4111-8111-111111111111",
    isDriver: false,
    role: "driver",
    editableSections: [] as string[],
  };
  assert.equal(canAccessDeliveryActs(assignedDriver, assignedDriver.id), true);
  assert.equal(
    canEditDeliveries(assignedDriver),
    false,
  );
});

test("деактивированный водитель не получает доступ к своим прежним актам", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    canAccessDeliveryActs(
      { id: userId, isDriver: false, role: "manager", editableSections: [] },
      userId,
    ),
    false,
  );
});

test("руководитель назначенного раздела подтверждает акт, но не редактирует и не загружает", () => {
  const manager = {
    id: "manager",
    isDriver: false,
    role: "manager",
    editableSections: ["deliveries"],
  };
  assert.equal(canApproveDeliveryActs(manager), true);
  assert.equal(canAccessDeliveryActs(manager, null), true);
  assert.equal(canEditDeliveries(manager), false);
  assert.equal(canUploadDeliveryActs(manager, null), false);
});

test("логист изменяет только назначенный раздел", () => {
  assert.equal(
    canEditDeliveries({
      id: "logistician",
      isDriver: false,
      role: "logistician",
      editableSections: ["deliveries"],
    }),
    true,
  );
  assert.equal(
    canEditDeliveries({
      id: "logistician",
      isDriver: false,
      role: "logistician",
      editableSections: ["sites"],
    }),
    false,
  );
});

test("старые значения ролей БД нормализуются в новую модель", () => {
  assert.equal(normalizeUserRole("editor"), "logistician");
  assert.equal(normalizeUserRole("viewer"), "manager");
  assert.equal(normalizeUserRole("driver"), "driver");
  assert.equal(normalizeUserRole("admin"), "admin");
});

test("старый флаг водителя в приглашении имеет приоритет над ролью", () => {
  assert.equal(normalizeInvitedUserRole("editor", true), "driver");
  assert.equal(normalizeInvitedUserRole("viewer", true), "driver");
  assert.equal(normalizeInvitedUserRole("editor", false), "logistician");
  assert.equal(normalizeInvitedUserRole("viewer", false), "manager");
});

test("к акту можно прикрепить только свежий PDF или изображение", () => {
  assert.equal(isUploadObjectPath("/objects/uploads/file_123-abc"), true);
  assert.equal(isUploadObjectPath("/objects/private/file_123"), false);
  assert.equal(isAllowedDeliveryActMimeType("application/pdf"), true);
  assert.equal(isAllowedDeliveryActMimeType("image/png"), true);
  assert.equal(isAllowedDeliveryActMimeType("text/html"), false);
});

test("один объект нельзя повторно прикрепить как акт", () => {
  assert.equal(isDeliveryActAlreadyAttached(undefined), false);
  assert.equal(isDeliveryActAlreadyAttached({ id: "existing-photo" }), true);
});