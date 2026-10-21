import { Router } from "express";
import { and, isNull, sql } from "drizzle-orm";
import { db, deliveriesTable, sitesTable, appUsersTable } from "@workspace/db";
import { ReviewDeliveryScheduleBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requirePermission";
import { isDriverUser } from "../lib/user-roles";
import { planSchedule } from "../lib/schedule-review";

const router = Router();
router.post("/deliveries/schedule-review", requireAdmin, async (req, res) => {
  const parsed = ReviewDeliveryScheduleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некорректный файл или месяц графика" }); return; }
  const body = parsed.data;
  if (new Set(body.rows.map(r => r.row)).size !== body.rows.length ||
      (body.selectedRows !== undefined && !body.fingerprint)) {
    res.status(400).json({ error: "Сначала выполните предпросмотр файла" }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      // A coherent snapshot and atomic apply, including approval/driver/site/order races.
      // Preview uses repeatable read without blocking operational writes.
      if (body.selectedRows !== undefined) {
        await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
        await tx.execute(sql`LOCK TABLE app_users, clients, sites, orders, order_summaries,
          order_summary_members, deliveries IN SHARE ROW EXCLUSIVE MODE`);
      } else {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      }
      const sites = await tx.select({ id: sitesTable.id, name: sitesTable.name, deliveryType: sitesTable.deliveryType })
        .from(sitesTable).orderBy(sitesTable.id);
      const users = await tx.select().from(appUsersTable).orderBy(appUsersTable.id);
      const deliveries = await tx.select().from(deliveriesTable).where(and(
        isNull(deliveriesTable.archivedAt),
        sql`coalesce(${deliveriesTable.scheduleMonth}, substring(${deliveriesTable.plannedDate}::text,1,7)) = ${body.month}`,
      )).orderBy(deliveriesTable.id);
      const frozen = await tx.execute<{ id: string }>(sql`
        SELECT DISTINCT d.id FROM deliveries d JOIN orders o
          ON o.fulfillment_delivery_id = d.id OR d.order_id = o.id
        WHERE o.is_paid OR EXISTS (SELECT 1 FROM order_summary_members m WHERE m.order_id = o.id)
        ORDER BY d.id`);
      const plan = planSchedule(body.month, body.rows, {
        sites, drivers: users.filter(u => isDriverUser(u) && u.name?.trim()).map(u => ({ id: u.id, name: u.name! })),
        deliveries, frozenIds: frozen.rows.map(r => r.id),
      });
      let updated = 0, created = 0;
      if (body.selectedRows !== undefined) {
        if (body.fingerprint !== plan.fingerprint) throw new Error("STALE_SCHEDULE");
        const selected = new Set(body.selectedRows);
        if (selected.size !== body.selectedRows.length ||
            [...selected].some(id => !plan.rows.some(r => r.row === id && ["update", "create"].includes(r.status)))) {
          throw new Error("INVALID_SELECTION");
        }
        const changes = plan.rows.filter(r => selected.has(r.row) && r.status === "update");
        const additions = plan.rows.filter(r => selected.has(r.row) && r.status === "create");
        // Batch writes keep the exclusive write window short for large monthly files.
        for (let i = 0; i < changes.length; i += 500) {
          const values = changes.slice(i, i + 500).map(row => {
            const target = plan.targets.get(row.row)!;
            return sql`(${target.deliveryId}::uuid, ${row.newDate}::date, ${target.driverId}::uuid)`;
          });
          await tx.execute(sql`UPDATE deliveries d SET planned_date = v.day, driver_user_id = v.driver
            FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, day, driver) WHERE d.id = v.id`);
        }
        for (let i = 0; i < additions.length; i += 500) {
          await tx.insert(deliveriesTable).values(additions.slice(i, i + 500).map(row => {
            const target = plan.targets.get(row.row)!;
            return {
              siteId: target.siteId, driverUserId: target.driverId, plannedDate: row.newDate,
              scheduleMonth: body.month, deliveryType: target.deliveryType,
            };
          }));
        }
        updated = changes.length;
        created = additions.length;
      }
      return { fingerprint: plan.fingerprint, rows: plan.rows, updated, created };
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "STALE_SCHEDULE" || message === "INVALID_SELECTION") {
      res.status(409).json({ error: "Данные или выбор изменились. Повторите предпросмотр и подтвердите изменения заново." });
      return;
    }
    throw error;
  }
});
export default router;
