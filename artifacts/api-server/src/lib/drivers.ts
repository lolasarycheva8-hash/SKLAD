import { and, eq, inArray, or } from "drizzle-orm";
import { appUsersTable, db } from "@workspace/db";

export async function findInvalidDriverUserIds(
  values: Array<string | null | undefined>,
): Promise<string[]> {
  const ids = [...new Set(values.filter((id): id is string => !!id))];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(
      and(
        inArray(appUsersTable.id, ids),
        or(
          eq(appUsersTable.role, "driver"),
          eq(appUsersTable.isDriver, true),
        ),
      ),
    );
  const valid = new Set(rows.map((row) => row.id));
  return ids.filter((id) => !valid.has(id));
}