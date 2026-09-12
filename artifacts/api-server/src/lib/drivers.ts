import { inArray } from "drizzle-orm";
import { appUsersTable, db } from "@workspace/db";
import { isDriverUser } from "./user-roles";

export { isDriverUser } from "./user-roles";

type DriverDatabase = Pick<typeof db, "select">;

export async function loadDriverUsers(
  values: Array<string | null | undefined>,
  database: DriverDatabase = db,
): Promise<{
  invalidIds: string[];
  namesById: Map<string, string>;
}> {
  const ids = [...new Set(values.filter((id): id is string => !!id))];
  if (ids.length === 0) {
    return { invalidIds: [], namesById: new Map() };
  }
  const rows = await database
    .select({
      id: appUsersTable.id,
      name: appUsersTable.name,
      email: appUsersTable.email,
      role: appUsersTable.role,
      isDriver: appUsersTable.isDriver,
    })
    .from(appUsersTable)
    .where(inArray(appUsersTable.id, ids));
  const validRows = rows.filter(isDriverUser);
  const validIds = new Set(validRows.map((row) => row.id));
  return {
    invalidIds: ids.filter((id) => !validIds.has(id)),
    namesById: new Map(
      validRows.map((row) => [
        row.id,
        row.name || row.email || "Не назначен",
      ]),
    ),
  };
}

export async function findInvalidDriverUserIds(
  values: Array<string | null | undefined>,
  database: DriverDatabase = db,
): Promise<string[]> {
  return (await loadDriverUsers(values, database)).invalidIds;
}
