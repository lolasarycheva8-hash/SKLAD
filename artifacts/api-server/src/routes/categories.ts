import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, categoriesTable } from "@workspace/db";
import {
  CreateCategoryBody,
  ListCategoriesResponse,
  CreateCategoryResponse,
  UpdateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryResponse,
  DeleteCategoryParams,
} from "@workspace/api-zod";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/categories", requireSectionAccess("products"));
const canEditProducts = requirePermission("products");

router.get("/categories", async (_req, res): Promise<void> => {
  const categories = await db
    .select()
    .from(categoriesTable)
    .orderBy(categoriesTable.name);
  res.json(ListCategoriesResponse.parse(categories));
});

router.post("/categories", canEditProducts, async (req, res): Promise<void> => {
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [category] = await db
    .insert(categoriesTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(CreateCategoryResponse.parse(category));
});

router.patch("/categories/:id", canEditProducts, async (req, res): Promise<void> => {
  const params = UpdateCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [category] = await db
    .update(categoriesTable)
    .set({ name: parsed.data.name })
    .where(eq(categoriesTable.id, params.data.id))
    .returning();

  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  res.json(UpdateCategoryResponse.parse(category));
});

router.delete("/categories/:id", canEditProducts, async (req, res): Promise<void> => {
  const params = DeleteCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [category] = await db
    .delete(categoriesTable)
    .where(eq(categoriesTable.id, params.data.id))
    .returning();

  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
