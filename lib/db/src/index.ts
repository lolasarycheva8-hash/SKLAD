import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { PoolClient } from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Bounded pool so a burst of concurrent requests queues instead of opening
// unlimited connections and exhausting Postgres. Tuned for a single app
// instance; autoscale runs multiple instances, so keep max modest per instance.
function poolMax(): number {
  const parsed = Number(process.env.DB_POOL_MAX);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return 10;
  }
  return parsed;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax(),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  // Don't crash the process on an idle-client error; log and let the pool recover.
  console.error("Unexpected idle Postgres client error", err);
});

export const db = drizzle(pool, { schema });

export function databaseForClient(client: PoolClient) {
  return drizzle(client, { schema });
}

export type { PoolClient };
export * from "./schema";
