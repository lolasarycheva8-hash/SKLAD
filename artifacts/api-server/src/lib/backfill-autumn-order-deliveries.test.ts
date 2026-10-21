import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { AUTUMN_ORDER_IDS, BACKFILL_AUTUMN_DELIVERIES_SQL } from "./backfill-autumn-order-deliveries";

test("approved snapshot only; undated months, existing links and repeat runs are safe", async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Development test only");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Isolated temporary tables: no business rows are touched.
    await db.query(`
      CREATE TEMP TABLE sites (id uuid PRIMARY KEY, client_id uuid, driver_user_id uuid, delivery_type text) ON COMMIT DROP;
      CREATE TEMP TABLE orders (id uuid PRIMARY KEY, site_id uuid, client_id uuid, planned_month text, fulfillment_delivery_id uuid) ON COMMIT DROP;
      CREATE TEMP TABLE deliveries (id uuid DEFAULT gen_random_uuid(), site_id uuid, order_id uuid UNIQUE,
        driver_user_id uuid, delivery_type text, planned_date date, schedule_month text) ON COMMIT DROP;
    `);
    const site = randomUUID(), client = randomUUID(), driver = randomUUID();
    await db.query("INSERT INTO sites VALUES ($1,$2,$3,'Расходные материалы')", [site, client, driver]);
    const ids = [...AUTUMN_ORDER_IDS.slice(0, 6), AUTUMN_ORDER_IDS[26], randomUUID()];
    for (let i = 0; i < ids.length; i++) {
      await db.query("INSERT INTO orders VALUES ($1,$2,$3,$4,$5)", [
        ids[i], i === 4 ? null : site, i === 5 ? randomUUID() : client,
        i === 3 ? "2026-12" : i === 6 ? "2026-11" : "2026-10",
        i === 1 ? randomUUID() : null,
      ]);
    }
    await db.query("INSERT INTO deliveries (site_id,order_id,planned_date,schedule_month) VALUES ($1,$2,'2026-10-23','2026-10')", [site, ids[2]]);
    assert.equal((await db.query(BACKFILL_AUTUMN_DELIVERIES_SQL, [AUTUMN_ORDER_IDS])).rowCount, 2);
    assert.equal((await db.query(BACKFILL_AUTUMN_DELIVERIES_SQL, [AUTUMN_ORDER_IDS])).rowCount, 0);
    const rows = (await db.query("SELECT order_id,planned_date::text,schedule_month,driver_user_id FROM deliveries ORDER BY schedule_month,order_id")).rows;
    assert.equal(rows.length, 3);
    assert.equal(rows.find(r => r.order_id === ids[2]).planned_date, "2026-10-23");
    for (const [id, month] of [[ids[0], "2026-10"], [ids[6], "2026-11"]]) {
      const row = rows.find(r => r.order_id === id);
      assert.equal(row.planned_date, null);
      assert.equal(row.schedule_month, month);
      assert.equal(row.driver_user_id, driver);
    }
    assert.equal(AUTUMN_ORDER_IDS.length, 28);
    assert.equal(new Set(AUTUMN_ORDER_IDS).size, 28);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
});
