import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";

import { and, eq, isNull } from "drizzle-orm";
import { db, deliveriesTable, deliveryPhotosTable } from "@workspace/db";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import {
  canAccessDeliveryActs,
  canUploadDeliveryActs,
} from "../lib/delivery-acts";
import { createStorageFailureLogFields } from "../lib/storage-log-sanitizer";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// This router is mounted behind requireAuth (Clerk); req.appUser is set for
// every authenticated request.
function hasAuthenticatedSession(req: Request): boolean {
  return !!req.appUser;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires auth middleware so public callers cannot mint write-capable URLs.
 */
router.post(
  "/storage/uploads/request-url",
  async (req: Request, res: Response) => {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: "Unauthorized" });

      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    try {
      const { name, size, contentType, deliveryId } = parsed.data;
      const [delivery] = await db
        .select({ driverUserId: deliveriesTable.driverUserId })
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, deliveryId))
        .limit(1);
      if (!delivery) {
        res.status(404).json({ error: "Доставка не найдена" });
        return;
      }
      if (!canUploadDeliveryActs(req.appUser, delivery.driverUserId)) {
        res
          .status(403)
          .json({ error: "Нет прав загружать акты этой доставки" });
        return;
      }

      // Autoscaled instances may have been asleep past the timer deadline.
      // This shared coordinator coalesces simultaneous requests and never
      // rejects an upload request solely because cleanup failed.
      const { deliveryUploadCleanupCoordinator } =
        await import("../lib/delivery-upload-cleanup-runtime");
      await deliveryUploadCleanupCoordinator.runIfDue();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error(
        createStorageFailureLogFields({
          operation: "request-upload-url",
          error,
        }),
        "Error generating upload URL",
      );
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  "/storage/public-objects/*filePath",
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      req.log.error(
        createStorageFailureLogFields({
          operation: "download-public-object",
          error,
          objectPath: filePath,
        }),
        "Error serving public object",
      );
      res.status(500).json({ error: "Failed to serve public object" });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
  const objectPath = `/objects/${wildcardPath}`;
  try {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Private objects are only served when they are registered in the app
    // (currently: delivery photo acts). This prevents authenticated users from
    // reading arbitrary private objects by guessing paths.
    const [registered] = await db
      .select({
        id: deliveryPhotosTable.id,
        driverUserId: deliveriesTable.driverUserId,
      })
      .from(deliveryPhotosTable)
      .innerJoin(
        deliveriesTable,
        eq(deliveryPhotosTable.deliveryId, deliveriesTable.id),
      )
      .where(
        and(
          eq(deliveryPhotosTable.objectPath, objectPath),
          isNull(deliveryPhotosTable.deletionPendingAt),
        ),
      )
      .limit(1);
    if (!registered) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    if (!canAccessDeliveryActs(req.appUser, registered.driverUserId)) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";
    const safeInlineTypes = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
    if (!safeInlineTypes.has(contentType)) {
      res.setHeader("Content-Disposition", 'attachment; filename="download"');
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn(
        createStorageFailureLogFields({
          operation: "download-private-object",
          error,
          objectPath,
        }),
        "Object not found",
      );
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error(
      createStorageFailureLogFields({
        operation: "download-private-object",
        error,
        objectPath,
      }),
      "Error serving object",
    );
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
