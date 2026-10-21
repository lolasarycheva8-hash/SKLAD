import type { Pool } from "pg";

// Explicit snapshot approved by the user. Never include future orders implicitly.
export const AUTUMN_ORDER_IDS = [
  "05d03268-e3a6-4053-9836-e28521f0fb41",
  "13d8a5a2-b0e5-4b07-a67b-9ff4b276aa16",
  "1d25c630-6292-4a7c-9764-d88859f21262",
  "2bb01aa4-4619-4a77-b099-5b4987c2c82c",
  "2e1f89e2-3bf2-453b-8e4f-2ca6029f6460",
  "326306b4-af5b-49cc-ac1f-8fe3937710cd",
  "41f577d5-2270-46ce-b820-8033ce096417",
  "4ad5fc11-2de0-4c26-998f-00c1a18aa36d",
  "4b40f066-5837-4382-a6c2-84ae966d16cd",
  "685de44d-138d-4483-8d38-3fc06d534941",
  "689170d5-fb9f-490f-b501-54b41b6e01a0",
  "84a57c82-3d47-4475-8726-2b062a9b7357",
  "8615fbcb-d321-4a0c-8ba9-8d370905b79f",
  "a339ccd4-4848-4490-824e-3a50966a8ee0",
  "b14188a1-3720-4e24-9308-569dc6537069",
  "b434c53c-e7fd-49d5-b369-5fc9200b7dc1",
  "c610a960-091b-4eac-82d2-68da3a2ec1ce",
  "cd63954a-e743-4ca6-a2cf-9630a8e7a7cc",
  "d430ad3d-7f9c-43b6-ad2e-4bf9ca47d03f",
  "d4444f7b-11ae-49eb-b0c5-cf8c3ddd6c2c",
  "e5e26b97-fc05-4dd0-9b75-ef45e6cc16e7",
  "e6f7714d-a0d2-4507-a1e0-10828233e16d",
  "ec0be9d7-52cb-49df-9189-756dd15c4257",
  "f2ee412c-b43b-447f-ac03-e5b39ee2e565",
  "fd204761-6c80-47e4-8ecd-16dff5d55cf3",
  "fe7d685b-71c1-4018-95ff-463bae60c299",
  "0605b229-ea68-4ac9-850c-b1056600d367",
  "da1478b3-4a67-43be-8f7a-e26e94950716",
];

export const BACKFILL_AUTUMN_DELIVERIES_SQL = `
  INSERT INTO deliveries (site_id, order_id, driver_user_id, delivery_type,
                          planned_date, schedule_month)
  SELECT o.site_id, o.id, s.driver_user_id, s.delivery_type, NULL, o.planned_month
  FROM orders o
  JOIN sites s ON s.id = o.site_id AND s.client_id = o.client_id
  WHERE o.id = ANY($1::uuid[])
    AND o.planned_month IN ('2026-10', '2026-11')
    AND o.fulfillment_delivery_id IS NULL
    AND s.driver_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id)
  ON CONFLICT (order_id) DO NOTHING
`;

export async function backfillAutumnOrderDeliveries(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    // Serialize with changes to destinations, fulfillment links and deliveries.
    await client.query("LOCK TABLE orders, sites, deliveries IN SHARE ROW EXCLUSIVE MODE");
    const result = await client.query(BACKFILL_AUTUMN_DELIVERIES_SQL, [AUTUMN_ORDER_IDS]);
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
