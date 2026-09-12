import { Router, type IRouter } from "express";
import { and, count, eq, ilike, ne, or, sql } from "drizzle-orm";
import {
  canonicalClientNameSql,
  clientsTable,
  db,
  normalizeClientNameWhitespace,
  ordersTable,
  sitesTable,
} from "@workspace/db";
import {
  ListClientsQueryParams,
  CreateClientBody,
  UpdateClientBody,
  UpdateClientParams,
  DeleteClientParams,
  ListClientsResponse,
  CreateClientResponse,
  UpdateClientResponse,
} from "@workspace/api-zod";
import {
  requirePermission,
  requireSectionAccess,
} from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/clients", requireSectionAccess("clients"));
const canEditClients = requirePermission("clients");

class ClientNameConflictError extends Error {}

function isNormalizedClientNameConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if (
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      (current.constraint === "clients_name_normalized_uq" ||
        current.constraint === "clients_name_unicode_normalized_uq" ||
        current.constraint === "clients_name_invisible_normalized_uq" ||
        current.constraint === "clients_name_canonical_uq")
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function toClientDto(row: typeof clientsTable.$inferSelect, siteCount = 0) {
  return {
    id: row.id,
    name: normalizeClientNameWhitespace(row.name),
    contact: row.contact,
    siteCount,
    createdAt: row.createdAt,
  };
}

router.get("/clients", async (req, res): Promise<void> => {
  const query = ListClientsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const rows = await db
    .select({
      client: clientsTable,
      siteCount: sql<number>`count(${sitesTable.id})::int`,
    })
    .from(clientsTable)
    .leftJoin(
      sitesTable,
      or(
        eq(sitesTable.clientId, clientsTable.id),
        and(
          sql`${sitesTable.clientId} is null`,
          sql`${canonicalClientNameSql(sitesTable.client)} = ${canonicalClientNameSql(clientsTable.name)}`,
        ),
      ),
    )
    .where(
      query.data.search
        ? ilike(
            canonicalClientNameSql(clientsTable.name),
            sql<string>`'%' || ${canonicalClientNameSql(query.data.search)} || '%'`,
          )
        : undefined,
    )
    .groupBy(clientsTable.id)
    .orderBy(canonicalClientNameSql(clientsTable.name));

  res.json(
    ListClientsResponse.parse(
      rows.map((row) => toClientDto(row.client, row.siteCount)),
    ),
  );
});

router.post("/clients", canEditClients, async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const name = normalizeClientNameWhitespace(parsed.data.name);
  if (!name) {
    res.status(400).json({ error: "Название клиента не может быть пустым" });
    return;
  }

  let client: typeof clientsTable.$inferSelect;
  try {
    client = await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE clients IN SHARE ROW EXCLUSIVE MODE`);
      const [existingClient] = await tx
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(
          sql`${canonicalClientNameSql(clientsTable.name)} = ${canonicalClientNameSql(name)}`,
        )
        .limit(1);
      if (existingClient) {
        throw new ClientNameConflictError(
          "Клиент с таким названием уже существует",
        );
      }

      const [createdClient] = await tx
        .insert(clientsTable)
        .values({
          name,
          contact: parsed.data.contact ?? null,
        })
        .returning();
      return createdClient;
    });
  } catch (error) {
    if (
      error instanceof ClientNameConflictError ||
      isNormalizedClientNameConflict(error)
    ) {
      res
        .status(409)
        .json({ error: "Клиент с таким названием уже существует" });
      return;
    }
    throw error;
  }

  res.status(201).json(CreateClientResponse.parse(toClientDto(client)));
});

router.patch(
  "/clients/:id",
  canEditClients,
  async (req, res): Promise<void> => {
    const params = UpdateClientParams.safeParse(req.params);
    const parsed = UpdateClientBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const updateValues: { name?: string; contact?: string | null } = {};
    if (parsed.data.name !== undefined) {
      const name = normalizeClientNameWhitespace(parsed.data.name);
      if (!name) {
        res
          .status(400)
          .json({ error: "Название клиента не может быть пустым" });
        return;
      }
      updateValues.name = name;
    }
    if (parsed.data.contact !== undefined) {
      updateValues.contact = parsed.data.contact?.trim() || null;
    }
    if (Object.keys(updateValues).length === 0) {
      res.status(400).json({ error: "Укажите данные клиента для изменения" });
      return;
    }

    let result: {
      client: typeof clientsTable.$inferSelect;
      siteCount: number;
    } | null;
    try {
      result = await db.transaction(async (tx) => {
        if (updateValues.name !== undefined) {
          // Keep the display snapshot current and progressively link legacy rows.
          // Site writes take the same locks in this order.
          await tx.execute(sql`LOCK TABLE clients IN SHARE ROW EXCLUSIVE MODE`);
          await tx.execute(sql`LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE`);
        }

        const [existingClient] = await tx
          .select()
          .from(clientsTable)
          .where(eq(clientsTable.id, params.data.id));
        if (!existingClient) return null;

        let linkedSiteCount: number | undefined;
        if (updateValues.name !== undefined) {
          const [ambiguousOldName] = await tx
            .select({ id: clientsTable.id })
            .from(clientsTable)
            .where(
              and(
                ne(clientsTable.id, existingClient.id),
                sql`${canonicalClientNameSql(clientsTable.name)} = ${canonicalClientNameSql(existingClient.name)}`,
              ),
            )
            .limit(1);
          if (ambiguousOldName) {
            throw new ClientNameConflictError(
              "Нельзя переименовать клиента: несколько клиентов имеют одинаковое текущее название",
            );
          }

          const [conflictingNewName] = await tx
            .select({ id: clientsTable.id })
            .from(clientsTable)
            .where(
              and(
                ne(clientsTable.id, existingClient.id),
                sql`${canonicalClientNameSql(clientsTable.name)} = ${canonicalClientNameSql(updateValues.name)}`,
              ),
            )
            .limit(1);
          if (conflictingNewName) {
            throw new ClientNameConflictError(
              "Клиент с таким названием уже существует",
            );
          }

          await tx
            .update(sitesTable)
            .set({
              client: existingClient.name,
              clientId: existingClient.id,
            })
            .where(
              and(
                sql`${sitesTable.clientId} is null`,
                sql`${canonicalClientNameSql(sitesTable.client)} = ${canonicalClientNameSql(existingClient.name)}`,
              ),
            );
          const [linkedSiteCountRow] = await tx
            .select({
              count: sql<number>`count(${sitesTable.id})::int`,
            })
            .from(sitesTable)
            .where(eq(sitesTable.clientId, existingClient.id));
          linkedSiteCount = linkedSiteCountRow?.count ?? 0;
        }

        const [client] = await tx
          .update(clientsTable)
          .set(updateValues)
          .where(eq(clientsTable.id, existingClient.id))
          .returning();

        if (updateValues.name !== undefined) {
          await tx
            .update(sitesTable)
            .set({ client: client.name })
            .where(eq(sitesTable.clientId, client.id));
        }

        if (linkedSiteCount === undefined) {
          const [countRow] = await tx
            .select({
              count: sql<number>`count(${sitesTable.id})::int`,
            })
            .from(sitesTable)
            .where(
              or(
                eq(sitesTable.clientId, client.id),
                and(
                  sql`${sitesTable.clientId} is null`,
                  sql`${canonicalClientNameSql(sitesTable.client)} = ${canonicalClientNameSql(client.name)}`,
                ),
              ),
            );
          linkedSiteCount = countRow?.count ?? 0;
        }

        return { client, siteCount: linkedSiteCount };
      });
    } catch (error) {
      if (error instanceof ClientNameConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }

    if (!result) {
      res.status(404).json({ error: "Клиент не найден" });
      return;
    }

    res.json(
      UpdateClientResponse.parse(toClientDto(result.client, result.siteCount)),
    );
  },
);

router.delete(
  "/clients/:id",
  canEditClients,
  async (req, res): Promise<void> => {
    const params = DeleteClientParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      // Serialize with client-linking site writes; FK remains the final guard.
      await tx.execute(sql`LOCK TABLE clients IN SHARE ROW EXCLUSIVE MODE`);
      await tx.execute(sql`LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE`);
      await tx.execute(sql`LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE`);

      const [existingClient] = await tx
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.id, params.data.id))
        .limit(1);
      if (!existingClient) return { status: 404 as const };

      const siteCondition = or(
        eq(sitesTable.clientId, existingClient.id),
        and(
          sql`${sitesTable.clientId} is null`,
          sql`${canonicalClientNameSql(sitesTable.client)} = ${canonicalClientNameSql(existingClient.name)}`,
        ),
      );
      const blockingSites = await tx
        .select({ id: sitesTable.id, name: sitesTable.name })
        .from(sitesTable)
        .where(siteCondition)
        .orderBy(sitesTable.name)
        .limit(3);
      if (blockingSites.length > 0) {
        const [{ value: siteCount }] = await tx
          .select({ value: count() })
          .from(sitesTable)
          .where(siteCondition);
        return {
          status: 409 as const,
          reason: "sites" as const,
          blockingSites: { count: siteCount, preview: blockingSites },
        };
      }

      const [existingOrder] = await tx
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(eq(ordersTable.clientId, existingClient.id))
        .limit(1);
      if (existingOrder)
        return { status: 409 as const, reason: "orders" as const };

      await tx
        .delete(clientsTable)
        .where(eq(clientsTable.id, existingClient.id));
      return { status: 204 as const };
    });

    if (outcome.status === 404) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    if (outcome.status === 409) {
      res.status(409).json({
        error:
          outcome.reason === "sites"
            ? "Нельзя удалить клиента, пока к нему привязаны объекты"
            : "Нельзя удалить клиента, у которого есть заказы",
        code:
          outcome.reason === "sites" ? "CLIENT_HAS_SITES" : "CLIENT_HAS_ORDERS",
        ...(outcome.reason === "sites"
          ? { blockingSites: outcome.blockingSites }
          : {}),
      });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;
