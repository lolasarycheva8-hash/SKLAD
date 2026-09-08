import assert from "node:assert/strict";
import test from "node:test";

import {
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