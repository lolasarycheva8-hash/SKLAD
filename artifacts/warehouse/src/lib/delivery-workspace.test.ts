import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeliveryImportReview,
  buildSkippedImportExportRows,
  canRescheduleDelivery,
  confirmPlannedDate,
  getDeliveryCellTone,
  getDriverDeliveryCategory,
  getMonthDateBounds,
  getInitialRescheduleDate,
  getRetryableDeliveryActFiles,
  getScheduleCellState,
  parseImportPlannedDate,
  removeDeliveryActById,
  toDateInputValue,
  uploadDeliveryActsSequentially,
} from "./delivery-workspace.ts";

const importFixtureRows = [
  {
    Объект: "Объект Альфа",
    Водитель: "Иван Водитель",
    "Email водителя": "driver@example.test",
    "Плановая дата": "2026-09-15",
  },
  {
    Объект: "Объект Бета",
    Водитель: "Иван Водитель",
    "Email водителя": "driver@example.test",
    "Плановая дата": "2026-10-02",
  },
  {
    Объект: "Объект Альфа",
    Водитель: "Иван Водитель",
    "Email водителя": "driver@example.test",
    "Плановая дата": "2026-09-15",
  },
  {
    Объект: "Новый объект Гамма",
    Водитель: "Иван Водитель",
    "Email водителя": "driver@example.test",
    "Плановая дата": "2026-09-18",
  },
  {
    Объект: "Новый объект Дельта",
    Водитель: "Иван Водитель",
    "Email водителя": "driver@example.test",
    "Плановая дата": "2026-09-19",
  },
];
const importFixtureSites = [
  { id: "site-alpha", name: "Объект Альфа", driverUserId: "driver-1" },
  { id: "site-beta", name: "Объект Бета", driverUserId: "driver-1" },
];
const importFixtureDrivers = [
  {
    id: "driver-1",
    name: "Иван Водитель",
    email: "driver@example.test",
  },
];

test("подтверждённая доставка без акта оранжевая в обеих вкладках", () => {
  const workspaceTone = getDeliveryCellTone("2026-09-05", 0);
  const scheduleTone = getScheduleCellState(
    [
      {
        plannedDate: "2026-09-05",
        actualDate: "2026-09-05",
        photosCount: 0,
      },
    ],
    "2026-09-05",
  ).tone;
  assert.equal(workspaceTone, "orange");
  assert.equal(scheduleTone, "orange");
});

test("подтверждённая доставка с актом зелёная в обеих вкладках", () => {
  const workspaceTone = getDeliveryCellTone("2026-09-05", 2);
  const scheduleTone = getScheduleCellState(
    [
      {
        plannedDate: "2026-09-05",
        actualDate: "2026-09-05",
        photosCount: 2,
      },
    ],
    "2026-09-05",
  ).tone;
  assert.equal(workspaceTone, "green");
  assert.equal(scheduleTone, "green");
});

test("акт без подтверждения логиста остаётся оранжевым, закрытый становится зелёным", () => {
  assert.equal(getDeliveryCellTone("2026-09-05", 2, "done"), "orange");
  assert.equal(getDeliveryCellTone("2026-09-05", 2, "closed"), "green");
  assert.equal(
    getScheduleCellState(
      [{
        plannedDate: "2026-09-05",
        actualDate: "2026-09-05",
        photosCount: 2,
        workflowStatus: "done",
      }],
      "2026-09-05",
    ).tone,
    "orange",
  );
  assert.equal(
    getScheduleCellState(
      [{
        plannedDate: "2026-09-05",
        actualDate: "2026-09-05",
        photosCount: 2,
        workflowStatus: "closed",
      }],
      "2026-09-05",
    ).tone,
    "green",
  );
});

test("любая доставка без нажатия «Выполнено» считается не выполненной независимо от даты", () => {
  assert.equal(getDriverDeliveryCategory("planned"), "not_completed");
  assert.equal(getDriverDeliveryCategory("done"), "done");
  assert.equal(getDriverDeliveryCategory("closed"), "closed");
});

test("выбор фактической даты ограничен первым и последним днём месяца", () => {
  assert.equal(
    confirmPlannedDate("2026-09-05T00:00:00.000Z"),
    "2026-09-05",
  );
  assert.deepEqual(getMonthDateBounds("2026-09"), {
    min: "2026-09-01",
    max: "2026-09-30",
  });
  assert.deepEqual(getMonthDateBounds("2024-02"), {
    min: "2024-02-01",
    max: "2024-02-29",
  });
});

test("перенос доступен только до выполнения и открывается с текущей датой", () => {
  assert.equal(canRescheduleDelivery(null), true);
  assert.equal(canRescheduleDelivery("2026-09-15T00:00:00.000Z"), false);
  assert.equal(
    getInitialRescheduleDate("2026-09-15T00:00:00.000Z"),
    "2026-09-15",
  );
  assert.equal(toDateInputValue("2026-09-15T00:00:00.000Z"), "2026-09-15");
});

test("parseImportPlannedDate возвращает null для пустых значений", () => {
  assert.deepEqual(parseImportPlannedDate("", "2026-09"), { valid: true, date: null });
  assert.deepEqual(parseImportPlannedDate(null, "2026-09"), { valid: true, date: null });
  assert.deepEqual(parseImportPlannedDate(undefined, "2026-09"), { valid: true, date: null });
});

test("parseImportPlannedDate валидирует корректную дату того же месяца", () => {
  assert.deepEqual(parseImportPlannedDate("2026-09-15", "2026-09"), { valid: true, date: "2026-09-15" });
  assert.deepEqual(parseImportPlannedDate(46279, "2026-09"), { valid: true, date: "2026-09-14" }); // Serial date
});

test("parseImportPlannedDate отклоняет даты других месяцев и некорректные", () => {
  assert.deepEqual(parseImportPlannedDate("2026-10-15", "2026-09"), { valid: false });
  assert.deepEqual(parseImportPlannedDate("2026-09-35", "2026-09"), { valid: false });
  assert.deepEqual(parseImportPlannedDate("invalid", "2026-09"), { valid: false });
});

test("отчёт импорта сохраняет все пропуски и отправляет только допустимые строки", () => {
  const review = buildDeliveryImportReview(
    importFixtureRows,
    "2026-09",
    importFixtureSites,
    importFixtureDrivers,
  );

  assert.deepEqual(review.items, [
    {
      siteId: "site-alpha",
      driverUserId: "driver-1",
      plannedDate: "2026-09-15",
      scheduleMonth: "2026-09",
    },
  ]);
  assert.deepEqual(
    review.skippedRows.map(({ rowNumber, siteName, reasonCode, reason }) => ({
      rowNumber,
      siteName,
      reasonCode,
      reason,
    })),
    [
      {
        rowNumber: 3,
        siteName: "Объект Бета",
        reasonCode: "other_month",
        reason:
          "Дата 2026-10-02 относится к другому месяцу; выбран сентябрь 26",
      },
      {
        rowNumber: 4,
        siteName: "Объект Альфа",
        reasonCode: "duplicate",
        reason:
          "Повтор объекта на 2026-09-15; загружена строка 2",
      },
      {
        rowNumber: 5,
        siteName: "Новый объект Гамма",
        reasonCode: "missing_site",
        reason: "Объект не найден в справочнике",
      },
      {
        rowNumber: 6,
        siteName: "Новый объект Дельта",
        reasonCode: "missing_site",
        reason: "Объект не найден в справочнике",
      },
    ],
  );
});

test("выгрузка пропусков содержит все причины в порядке исходного Excel", () => {
  const review = buildDeliveryImportReview(
    importFixtureRows,
    "2026-09",
    importFixtureSites,
    importFixtureDrivers,
  );

  assert.deepEqual(buildSkippedImportExportRows(review.skippedRows), [
    {
      Строка: 3,
      Объект: "Объект Бета",
      Причина:
        "Дата 2026-10-02 относится к другому месяцу; выбран сентябрь 26",
    },
    {
      Строка: 4,
      Объект: "Объект Альфа",
      Причина: "Повтор объекта на 2026-09-15; загружена строка 2",
    },
    {
      Строка: 5,
      Объект: "Новый объект Гамма",
      Причина: "Объект не найден в справочнике",
    },
    {
      Строка: 6,
      Объект: "Новый объект Дельта",
      Причина: "Объект не найден в справочнике",
    },
  ]);
});

test("несколько актов загружаются и прикрепляются строго последовательно", async () => {
  const events: string[] = [];
  const results = await uploadDeliveryActsSequentially(
    ["first.pdf", "second.png", "third.jpg"],
    async (file) => {
      events.push(`upload:${file}`);
      return `/objects/uploads/${file}`;
    },
    async (file) => {
      events.push(`attach:${file}`);
    },
  );
  assert.deepEqual(events, [
    "upload:first.pdf",
    "attach:first.pdf",
    "upload:second.png",
    "attach:second.png",
    "upload:third.jpg",
    "attach:third.jpg",
  ]);
  assert.deepEqual(
    results.map(({ file, status }) => ({ file, status })),
    [
      { file: "first.pdf", status: "added" },
      { file: "second.png", status: "added" },
      { file: "third.jpg", status: "added" },
    ],
  );
});

test("ошибка одного акта не прерывает очередь и возвращает частичный результат", async () => {
  const attached: string[] = [];
  const results = await uploadDeliveryActsSequentially(
    ["first.pdf", "broken.png", "third.jpg"],
    async (file) => `/objects/uploads/${file}`,
    async (file) => {
      if (file === "broken.png") throw new Error("attachment rejected");
      attached.push(file);
    },
  );

  assert.deepEqual(attached, ["first.pdf", "third.jpg"]);
  assert.deepEqual(
    results.map(({ file, status }) => ({ file, status })),
    [
      { file: "first.pdf", status: "added" },
      { file: "broken.png", status: "failed" },
      { file: "third.jpg", status: "added" },
    ],
  );
});

test("неудачные акты нельзя повторить для другой доставки", () => {
  const failedFile = { name: "broken.pdf" };
  const session = {
    deliveryId: "delivery-a",
    results: [
      { file: { name: "added.pdf" }, status: "added" as const },
      { file: failedFile, status: "failed" as const, error: new Error("failed") },
    ],
  };

  assert.deepEqual(
    getRetryableDeliveryActFiles(session, "delivery-a"),
    [failedFile],
  );
  assert.deepEqual(getRetryableDeliveryActFiles(session, "delivery-b"), []);
  assert.deepEqual(getRetryableDeliveryActFiles(null, "delivery-a"), []);
});

test("удалённый акт исчезает из списка, остальные сохраняются", () => {
  assert.deepEqual(
    removeDeliveryActById(
      [
        { id: "pdf", fileName: "act.pdf" },
        { id: "image", fileName: "act.png" },
      ],
      "pdf",
    ),
    [{ id: "image", fileName: "act.png" }],
  );
});