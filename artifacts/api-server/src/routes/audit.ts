import { Router, type IRouter } from "express";
import { desc, eq, sql, and, type SQL } from "drizzle-orm";
import { db, auditLogTable, deliveryUploadCleanupStatusTable } from "@workspace/db";
import {
  GetDeliveryUploadCleanupHealthResponse,
  ListAuditLogQueryParams,
  ListAuditLogResponse,
} from "@workspace/api-zod";
import { getDeliveryUploadCleanupConfig } from "../lib/delivery-upload-cleanup";
import { requireAdmin } from "../middlewares/requirePermission";

const router: IRouter = Router();
const REPEATED_CLEANUP_FAILURE_THRESHOLD = 2;

router.get("/audit/delivery-upload-cleanup", requireAdmin, async (_req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(deliveryUploadCleanupStatusTable)
    .where(eq(deliveryUploadCleanupStatusTable.key, "automatic"))
    .limit(1);
  const staleAfterHours = getDeliveryUploadCleanupConfig().intervalHours * 2;
  const lastSuccessfulRunAt = row?.lastSuccessfulRunAt ?? null;
  const isStale =
    lastSuccessfulRunAt === null ||
    Date.now() - lastSuccessfulRunAt.getTime() > staleAfterHours * 60 * 60 * 1000;

  res.json(
    GetDeliveryUploadCleanupHealthResponse.parse({
      lastRunAt: row?.lastRunAt ?? null,
      lastSuccessfulRunAt,
      status: row?.status ?? "never",
      failureKind: row?.failureKind ?? "none",
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      hasRepeatedFailures:
        (row?.consecutiveFailures ?? 0) >= REPEATED_CLEANUP_FAILURE_THRESHOLD,
      summary: row
        ? {
            scanned: row.scanned,
            candidates: row.candidates,
            deleted: row.deleted,
            resumedPhotoDeletions: row.resumedPhotoDeletions,
            resumedDeliveryDeletions: row.resumedDeliveryDeletions,
            failed: row.failed,
          }
        : null,
      staleAfterHours,
      isStale,
    }),
  );
});

router.get("/audit", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListAuditLogQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;

  const conditions: SQL[] = [];
  if (parsed.data.entity) {
    conditions.push(eq(auditLogTable.entity, parsed.data.entity));
  }
  if (parsed.data.userId) {
    conditions.push(eq(auditLogTable.userId, parsed.data.userId));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(auditLogTable)
      .where(where)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogTable)
      .where(where),
  ]);

  res.json(
    ListAuditLogResponse.parse({
      items: rows,
      total,
    }),
  );
});

export default router;
