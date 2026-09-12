import assert from "node:assert/strict";
import test from "node:test";
import type { Delivery } from "@workspace/api-client-react";

import {
  buildDeliveryFactUpdates,
  deliveryFactExportRows,
} from "./delivery-fact-import.ts";

function delivery(
  id: string,
  siteName: string,
  plannedDate: string | null,
  actualDate: string | null = null,
): Delivery {
  return {
    id,
    siteId: `site-${id}`,
    siteName,
    siteAddress: "",
    driverUserId: "driver-1",
    driver: "Иван Водитель",
    plannedDate,
    scheduleMonth: "2026-09",
    actualDate,
    actApprovedAt: null,
    actApprovedBy: null,
    workflowStatus: "pending",
    note: null,
    logisticianNote: null,
    status: "pending",
    lagDays: null,
    rescheduledFromDate: null,
    rescheduledBy: null,
    rescheduledAt: null,
    photosCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

test("шаблон факта содержит все датированные доставки периода по порядку", () => {
  const rows = deliveryFactExportRows([
    delivery("2", "Бета", "2026-09-12"),
    delivery("3", "Без даты", null),
    delivery("1", "Альфа", "2026-09-10", "2026-09-11"),
  ]);

  assert.deepEqual(rows, [
    {
      Объект: "Альфа",
      Водитель: "Иван Водитель",
      "Плановая дата": "10.09.2026",
      "Дата факта": "11.09.2026",
    },
    {
      Объект: "Бета",
      Водитель: "Иван Водитель",
      "Плановая дата": "12.09.2026",
      "Дата факта": "",
    },
  ]);
});

test("загрузка отличает доставки одного объекта в разные дни", () => {
  const deliveries = [
    delivery("first", "Объект 50020", "2026-09-09"),
    delivery("second", "Объект 50020", "2026-09-12"),
  ];

  const result = buildDeliveryFactUpdates(
    [
      {
        Объект: "Объект 50020",
        "Плановая дата": "12.09.2026",
        "Дата факта": "13.09.2026",
      },
    ],
    deliveries,
  );

  assert.deepEqual(result, {
    updates: [{ id: "second", actualDate: "2026-09-13" }],
    unmatched: [],
  });
});