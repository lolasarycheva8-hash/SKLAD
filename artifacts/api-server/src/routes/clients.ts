import { Router, type IRouter } from "express";
import { eq, ilike } from "drizzle-orm";
import { db, clientsTable, ordersTable } from "@workspace/db";
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
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/clients", requireSectionAccess("clients"));
const canEditClients = requirePermission("clients");

function toClientDto(row: typeof clientsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
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
    .select()
    .from(clientsTable)
    .where(query.data.search ? ilike(clientsTable.name, `%${query.data.search}%`) : undefined)
    .orderBy(clientsTable.name);

  res.json(ListClientsResponse.parse(rows.map(toClientDto)));
});

router.post("/clients", canEditClients, async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db
    .insert(clientsTable)
    .values({
      name: parsed.data.name,
      contact: parsed.data.contact ?? null,
    })
    .returning();

  res.status(201).json(CreateClientResponse.parse(toClientDto(client)));
});

router.patch("/clients/:id", canEditClients, async (req, res): Promise<void> => {
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
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ error: "Название клиента не может быть пустым" });
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

  const [client] = await db
    .update(clientsTable)
    .set(updateValues)
    .where(eq(clientsTable.id, params.data.id))
    .returning();

  if (!client) {
    res.status(404).json({ error: "Клиент не найден" });
    return;
  }

  res.json(UpdateClientResponse.parse(toClientDto(client)));
});

router.delete("/clients/:id", canEditClients, async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existingOrder] = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.clientId, params.data.id));

  if (existingOrder) {
    res.status(409).json({ error: "Нельзя удалить клиента, у которого есть заказы" });
    return;
  }

  const [client] = await db
    .delete(clientsTable)
    .where(eq(clientsTable.id, params.data.id))
    .returning();

  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
