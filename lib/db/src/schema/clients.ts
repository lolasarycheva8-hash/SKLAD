import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const CLIENT_NAME_WHITESPACE_SQL_PATTERN =
  String.raw`U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+'`;

export const CLIENT_NAME_INVISIBLE_SQL_PATTERN =
  String.raw`U&'[\200B-\200D\2060]+'`;

const CLIENT_NAME_WHITESPACE_PATTERN =
  /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+/gu;
const CLIENT_NAME_INVISIBLE_PATTERN = /[\u200B-\u200D\u2060]+/gu;

export function normalizeClientNameWhitespace(value: string): string {
  return value
    .replace(CLIENT_NAME_INVISIBLE_PATTERN, "")
    .replace(CLIENT_NAME_WHITESPACE_PATTERN, " ")
    .trim();
}

export function canonicalClientNameSql(
  value: SQLWrapper | string,
): SQL<string> {
  return sql<string>`lower(btrim(regexp_replace(regexp_replace(${value}, ${sql.raw(
    CLIENT_NAME_INVISIBLE_SQL_PATTERN,
  )}, '', 'g'), ${sql.raw(CLIENT_NAME_WHITESPACE_SQL_PATTERN)}, ' ', 'g'), ' '))`;
}

export const clientsTable = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contact: text("contact"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("clients_id_name_uq").on(table.id, table.name),
    uniqueIndex("clients_name_normalized_uq").on(
      sql`lower(trim(${table.name}))`,
    ),
  ],
);

export const insertClientSchema = createInsertSchema(clientsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
