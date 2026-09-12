import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
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
  deliveryActArchiveEntryName,
  preflightDeliveryActObjects,
  sanitizeArchiveName,
  streamDeliveryActsZip,
  validateDeliveryActDateRange,
} from "./delivery-act-download.ts";
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

test("назначенный пользователь с legacy-флагом водителя видит и загружает акты", () => {
  const driverUserId = "11111111-1111-4111-8111-111111111111";
  const legacyDriver = {
    id: driverUserId,
    isDriver: true,
    role: "manager",
    editableSections: [] as string[],
  };

  assert.equal(canUploadDeliveryActs(legacyDriver, driverUserId), true);
  assert.equal(canAccessDeliveryActs(legacyDriver, driverUserId), true);
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

test("диапазон выгрузки актов принимает ISO даты не длиннее 366 дней", () => {
  assert.deepEqual(validateDeliveryActDateRange("2024-01-01", "2024-12-31"), {
    success: true,
    from: "2024-01-01",
    to: "2024-12-31",
  });
  assert.equal(validateDeliveryActDateRange("2024-02-30", "2024-03-01").success, false);
  assert.equal(validateDeliveryActDateRange("2024-03-02", "2024-03-01").success, false);
  assert.equal(validateDeliveryActDateRange("2023-01-01", "2024-01-02").success, false);
});

test("имена файлов ZIP безопасны, уникальны и не содержат storage-путь", () => {
  assert.equal(sanitizeArchiveName("../опасный/акт?.pdf", "акт"), "_опасный_акт_.pdf");
  const item = {
    objectPath: "/objects/uploads/private-secret",
    fileName: "../акт.pdf",
    actualDate: "2026-09-15",
    siteName: "Объект/один",
  };
  const first = deliveryActArchiveEntryName(item);
  const second = deliveryActArchiveEntryName(item, 2);
  assert.equal(first, "Объект_один-15.09.2026.pdf");
  assert.equal(second, "Объект_один-15.09.2026-2.pdf");
  assert.notEqual(first, second);
  assert.equal(first.includes("objects/uploads"), false);
  assert.equal(first.includes(".."), false);
});

test("ZIP стримит несколько актов с безопасными именами", async () => {
  const chunks: Buffer[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const items = [
    {
      objectPath: "/objects/uploads/private-first",
      fileName: "first.txt",
      actualDate: "2026-09-15",
      siteName: "site",
    },
    {
      objectPath: "/objects/uploads/private-second",
      fileName: "second.txt",
      actualDate: "2026-09-15",
      siteName: "site",
    },
  ];
  await streamDeliveryActsZip(
    items,
    output,
    async (item) => Readable.from([item.fileName]),
  );
  const archive = Buffer.concat(chunks).toString("latin1");
  assert.match(archive, /site-15\.09\.2026\.txt/);
  assert.match(archive, /site-15\.09\.2026-2\.txt/);
  assert.equal(archive.includes("objects/uploads"), false);
  assert.equal(archive.includes("private-first"), false);
});

test("ZIP propagates source failures and aborts an open stream", async () => {
  const item = {
    objectPath: "/objects/uploads/source-error",
    fileName: "source.txt",
    actualDate: "2026-09-15",
    siteName: "site",
  };
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  await assert.rejects(
    streamDeliveryActsZip(
      [item],
      output,
      async () => {
        const source = new Readable({ read() {} });
        setTimeout(() => source.destroy(new Error("source failed")), 10);
        return source;
      },
    ),
    /source failed/,
  );

  const controller = new AbortController();
  const pendingOpen = streamDeliveryActsZip(
    [item],
    new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    () => new Promise<Readable>(() => {}),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pendingOpen, /aborted/i);
});

test("late open stream is safely destroyed after abort", async () => {
  let resolveOpen!: (stream: Readable) => void;
  const controller = new AbortController();
  const unexpected: unknown[] = [];
  const onUncaught = (error: unknown) => unexpected.push(error);
  const onUnhandled = (error: unknown) => unexpected.push(error);
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);
  try {
    const pending = streamDeliveryActsZip(
      [{
        objectPath: "/objects/uploads/late",
        fileName: "late.txt",
        actualDate: "2026-09-15",
        siteName: "site",
      }],
      new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      () => new Promise<Readable>((resolve) => {
        resolveOpen = resolve;
      }),
      controller.signal,
    );
    controller.abort();
    await assert.rejects(pending, /aborted/i);
    const lateStream = new Readable({ read() {} });
    resolveOpen(lateStream);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(lateStream.destroyed, true);
    assert.deepEqual(unexpected, []);
  } finally {
    process.removeListener("uncaughtException", onUncaught);
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("pre-aborted signal rejects before calling openStream", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    streamDeliveryActsZip(
      [{
        objectPath: "/objects/uploads/pre-aborted",
        fileName: "act.txt",
        actualDate: null,
        siteName: "site",
      }],
      new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      async () => {
        called = true;
        return Readable.from(["unexpected"]);
      },
      controller.signal,
    ),
    /aborted/i,
  );
  assert.equal(called, false);
});

test("preflight stops scheduling after the first worker failure", async () => {
  const items = Array.from({ length: 30 }, (_, index) => ({
    objectPath: `/objects/uploads/${index}`,
    fileName: `${index}.txt`,
    actualDate: null,
    siteName: "site",
  }));
  const called: string[] = [];
  await assert.rejects(
    preflightDeliveryActObjects(
      items,
      async (item) => {
        called.push(item.objectPath);
        if (item === items[0]) throw new Error("missing object");
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
      new AbortController().signal,
    ),
    /missing object/,
  );
  assert.equal(called.length <= 8, true);
});

test("ZIP propagates output failures", async () => {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("output failed"));
    },
  });
  await assert.rejects(
    streamDeliveryActsZip(
      [{
        objectPath: "/objects/uploads/output-error",
        fileName: "output.txt",
        actualDate: "2026-09-15",
        siteName: "site",
      }],
      output,
      async () => new Readable({ read() {} }),
    ),
    /output failed|Archive output closed prematurely/,
  );
});