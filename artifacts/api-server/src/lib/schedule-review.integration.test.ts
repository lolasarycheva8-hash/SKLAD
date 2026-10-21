import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool, appUsersTable, clientsTable, sitesTable, deliveriesTable, deliveryPhotosTable, ordersTable } from "@workspace/db";
import router from "../routes/schedule-review";
import type { AuthenticatedAppUser } from "./user-roles";
import type { ScheduleReviewResult } from "@workspace/api-zod";

test("preview/apply is atomic, stale-safe, admin-only and preserves delivery work and order links", async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Development only");
  const suffix = randomUUID();
  const now = new Date();
  const actor: AuthenticatedAppUser = {
    id: randomUUID(), clerkUserId: `schedule-${suffix}`, email: `${suffix}@example.test`,
    name: `Проверка ${suffix}`, role: "admin", isDriver: true, phone: null,
    editableSections: [], assignedSiteIds: null, createdAt: now, updatedAt: now,
  };
  let clientId = "", orderId = "";
  const siteIds: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.appUser = actor; next(); });
  app.use(router);
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/deliveries/schedule-review`;
  const request = (body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    await db.insert(appUsersTable).values(actor);
    const [client] = await db.insert(clientsTable).values({ name: `Schedule ${suffix}` }).returning();
    clientId = client.id;
    for (let i = 0; i < 4; i++) {
      const [site] = await db.insert(sitesTable).values({
        name: `Schedule ${suffix} ${i}`, address: "Тест", branch: "", client: client.name, clientId,
        manager: "", director: "", project: "", driverUserId: actor.id,
      }).returning();
      siteIds.push(site.id);
    }
    const [first, completed, absent] = await db.insert(deliveriesTable).values(siteIds.slice(0, 3).map((siteId, i) => ({
      siteId, driverUserId: actor.id, scheduleMonth: "2026-10", plannedDate: "2026-10-01",
      actualDate: i === 1 ? "2026-10-01" : null, note: "Комментарий водителя", logisticianNote: "Сохранить",
    }))).returning();
    const [order] = await db.insert(ordersTable).values({
      clientId, siteId: siteIds[0], plannedMonth: "2026-10", fulfillmentDeliveryId: first.id,
    }).returning();
    orderId = order.id;
    await db.insert(deliveryPhotosTable).values({
      deliveryId: first.id, objectPath: `/test/${suffix}`, uploadedBy: "test",
    });
    const input = { month: "2026-10", rows: [0, 1, 3].map((i, index) => ({
      row: index + 2, siteName: `Schedule ${suffix} ${i}`, driverName: actor.name, plannedDate: "2026-10-02",
    })) };
    const previewResponse = await request(input);
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as ScheduleReviewResult;
    assert.deepEqual(preview.rows.map((r: { status: string }) => r.status), ["update", "protected", "create"]);
    assert.equal((await request({ ...input, fingerprint: preview.fingerprint, selectedRows: [2, 3] })).status, 409);
    assert.equal((await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, first.id)))[0].plannedDate, "2026-10-01");
    await db.update(deliveriesTable).set({ logisticianNote: "Изменено другим пользователем" }).where(eq(deliveriesTable.id, first.id));
    assert.equal((await request({ ...input, fingerprint: preview.fingerprint, selectedRows: [2, 4] })).status, 409);
    const fresh = await (await request(input)).json() as ScheduleReviewResult;
    const applied = await request({ ...input, fingerprint: fresh.fingerprint, selectedRows: [2, 4] });
    assert.equal(applied.status, 200);
    const result = await applied.json() as ScheduleReviewResult;
    assert.equal(result.updated, 1);
    assert.equal(result.created, 1);
    const saved = await db.select().from(deliveriesTable).where(inArray(deliveriesTable.siteId, siteIds));
    assert.equal(saved.length, 4);
    const same = saved.find(r => r.id === first.id)!;
    assert.equal(same.plannedDate, "2026-10-02");
    assert.equal(same.note, first.note);
    assert.equal(same.logisticianNote, "Изменено другим пользователем");
    assert.equal(saved.find(r => r.id === completed.id)!.actualDate, "2026-10-01");
    assert.equal(saved.find(r => r.id === absent.id)!.plannedDate, "2026-10-01");
    assert.equal((await db.select().from(deliveryPhotosTable).where(eq(deliveryPhotosTable.deliveryId, first.id))).length, 1);
    assert.equal((await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)))[0].fulfillmentDeliveryId, first.id);
    assert.equal((await request({ ...input, fingerprint: fresh.fingerprint, selectedRows: [2, 4] })).status, 409);
    actor.role = "driver";
    assert.equal((await request(input)).status, 403);
  } finally {
    if (orderId) await db.delete(ordersTable).where(eq(ordersTable.id, orderId));
    if (siteIds.length) {
      const rows = await db.select().from(deliveriesTable).where(inArray(deliveriesTable.siteId, siteIds));
      if (rows.length) await db.delete(deliveryPhotosTable).where(inArray(deliveryPhotosTable.deliveryId, rows.map(r => r.id)));
      await db.delete(deliveriesTable).where(inArray(deliveriesTable.siteId, siteIds));
      await db.delete(sitesTable).where(inArray(sitesTable.id, siteIds));
    }
    if (clientId) await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, actor.id));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
