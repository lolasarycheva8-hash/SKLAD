import { spawn } from "node:child_process";
import pg from "pg";
import { lookup } from "node:dns/promises";
import { bounded, operationSignal } from "./runtime";

export const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;
export async function command(tool: "pg_dump" | "pg_restore", args: string[], connection: string) {
  const url = new URL(connection);
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" };
  Object.assign(env, {
    PGHOST: url.hostname, PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "30", PGAPPNAME: "warehouse-backup",
  });
  // Match libpq TLS settings without leaking URLs into process arguments.
  const options: Record<string, string> = { sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY", channel_binding: "PGCHANNELBINDING" };
  for (const [name, value] of url.searchParams) {
    if (!options[name]) throw new Error(`Unsupported PostgreSQL URL option: ${name}`);
    env[options[name]] = value;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tool, args, { env, stdio: ["ignore", "ignore", "pipe"], timeout: 25 * 60 * 1000, signal: operationSignal(25 * 60_000), killSignal: "SIGTERM" });
    // Drain but never log database names, SQL, credentials or PII from pg tools.
    child.stderr.resume();
    child.once("error", () => reject(new Error(`${tool} could not start`)));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${tool} failed (exit ${code ?? "signal"})`)));
  });
}
export function pool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 30_000, query_timeout: 120_000, statement_timeout: 120_000, application_name: "warehouse-backup" });
}
export async function counts(client: pg.PoolClient) {
  const tables = await client.query<{ schema: string; name: string }>("SELECT schemaname AS schema, tablename AS name FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname,tablename");
  const result: Record<string, string> = {};
  for (const { schema, name } of tables.rows) {
    const key = `${ident(schema)}.${ident(name)}`;
    result[key] = (await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${key}`)).rows[0].count;
  }
  return result;
}
export async function distinctHosts(source: string, target: string) {
  const a = await bounded(lookup(new URL(source).hostname, { all: true }), 10_000);
  const b = await bounded(lookup(new URL(target).hostname, { all: true }), 10_000);
  if (a.some(x => b.some(y => x.address === y.address))) throw new Error("Source and restore host resolve to the same address");
}
export async function schema(client: pg.PoolClient) {
  const columns = await client.query("SELECT table_schema,table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,identity_generation FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name,ordinal_position");
  const constraints = await client.query("SELECT n.nspname AS schema,c.relname AS name,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY n.nspname,c.relname,k.conname");
  const indexes = await client.query("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename,indexname");
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}