import assert from "node:assert/strict";
import test from "node:test";
import { handleAlreadyDeletedDelivery } from "./delivery-delete-error.ts";

test("update: для HTTP 404 обновляет список, закрывает устаревший диалог и показывает объяснение", () => {
  let invalidations = 0;
  let clearedTargets = 0;
  const notices: Array<{ title: string; description: string }> = [];

  const handled = handleAlreadyDeletedDelivery(
    { status: 404 },
    {
      invalidate: () => {
        invalidations += 1;
      },
      closeStaleDialog: () => {
        clearedTargets += 1;
      },
      notify: (notice) => notices.push(notice),
    },
  );

  assert.equal(handled, true);
  assert.equal(invalidations, 1);
  assert.equal(clearedTargets, 1);
  assert.deepEqual(notices, [
    {
      title: "Доставка уже удалена",
      description: "Список обновлён: запись удалил другой администратор.",
    },
  ]);
});

test("reschedule: для HTTP 404 обновляет список и закрывает диалог переноса", () => {
  let invalidations = 0;
  let closedDialogs = 0;
  const notices: Array<{ title: string; description: string }> = [];

  const handled = handleAlreadyDeletedDelivery(
    { status: 404 },
    {
      invalidate: () => {
        invalidations += 1;
      },
      closeStaleDialog: () => {
        closedDialogs += 1;
      },
      notify: (notice) => notices.push(notice),
    },
  );

  assert.equal(handled, true);
  assert.equal(invalidations, 1);
  assert.equal(closedDialogs, 1);
  assert.equal(notices[0]?.title, "Доставка уже удалена");
});

test("для настоящей ошибки не выполняет побочные действия", () => {
  let sideEffects = 0;
  const handled = handleAlreadyDeletedDelivery(
    { status: 500 },
    {
      invalidate: () => {
        sideEffects += 1;
      },
      closeStaleDialog: () => {
        sideEffects += 1;
      },
      notify: () => {
        sideEffects += 1;
      },
    },
  );

  assert.equal(handled, false);
  assert.equal(sideEffects, 0);
});