import pg from "pg";
import { inspectClientNameConflicts, formatConflictReport, clientNameConflictsQuery } from "./client-name-conflicts.mjs";

// This command deliberately has no apply/repair/DDL mode.
if (process.argv.includes("--print-sql")) {
  console.log(clientNameConflictsQuery().sql);
} else {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
  });
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const report = await inspectClientNameConflicts(client);
    await client.query("ROLLBACK");
    console.log(formatConflictReport(report));
    process.exitCode = report.groups.length ? 2 : 0;
  } catch {
    // No connection strings, SQL parameters or raw database errors in output.
    console.error("Проверка имён клиентов не выполнена. Изменение схемы запрещено; проверьте доступность базы и наличие таблиц.");
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}