import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { canonicalClientNameSql } from "../src/schema/clients.ts";

const dialect = new PgDialect();
const table = (schema, name) => sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
const column = (alias, name) => sql`${sql.identifier(alias)}.${sql.identifier(name)}`;

/** Same PostgreSQL canonicalizer as the API, never JS lowercasing. */
export function clientNameConflictsQuery(schema = "public") {
  const clients = table(schema, "clients");
  const sites = table(schema, "sites");
  const orders = table(schema, "orders");
  const canonicalName = canonicalClientNameSql(column("c", "name"));
  return dialect.sqlToQuery(sql`
    WITH duplicates AS (
      SELECT ${canonicalName} AS canonical_name
      FROM ${clients} c
      GROUP BY ${canonicalName}
      HAVING count(*) > 1
    )
    SELECT d.canonical_name AS "canonicalName",
      jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'siteCount', (SELECT count(*) FROM ${sites} s WHERE s.client_id = c.id),
        'orderCount', (SELECT count(*) FROM ${orders} o WHERE o.client_id = c.id)
      ) ORDER BY c.id) AS clients,
      (SELECT count(*)::int FROM ${sites} s
        WHERE s.client_id IS NULL
          AND ${canonicalClientNameSql(column("s", "client"))} = d.canonical_name
      ) AS "unlinkedSiteCount"
    FROM duplicates d
    JOIN ${clients} c ON ${canonicalName} = d.canonical_name
    GROUP BY d.canonical_name
    ORDER BY d.canonical_name
  `);
}

/** Read-only: safe to run repeatedly, including on historical duplicates. */
export async function inspectClientNameConflicts(client, schema = "public") {
  const presenceQuery = dialect.sqlToQuery(sql`SELECT to_regclass(${`${schema}.clients`}) AS relation`);
  const presence = await client.query(presenceQuery.sql, presenceQuery.params);
  if (!presence.rows[0].relation) {
    return { checked: false, groups: [], reason: "Таблица clients ещё не создана" };
  }
  const statement = clientNameConflictsQuery(schema);
  const { rows } = await client.query(statement.sql, statement.params);
  return {
    checked: true,
    groups: rows.map((group) => ({
      ...group,
      clients: group.clients.map((entry) => ({
        ...entry,
        // Make invisible differences readable without replacing the original name.
        escapedName: entry.name.replace(/[\u200B-\u200D\u2060]/gu,
          (character) => `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`),
      })),
    })),
  };
}

export function formatConflictReport(report) {
  return JSON.stringify({
    ok: report.groups.length === 0,
    ...report,
    message: report.groups.length
      ? "Остановлено до изменения схемы: найдены визуальные дубли клиентов. См. docs/client-name-index-preflight.md. Данные и индексы не изменены."
      : "Конфликтов имён клиентов не найдено. Проверка не изменяла данные или схему.",
  }, null, 2);
}