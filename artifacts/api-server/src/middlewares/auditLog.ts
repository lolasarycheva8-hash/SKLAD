import type { NextFunction, Request, Response } from "express";
import { db, auditLogTable } from "@workspace/db";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const MAX_META_BYTES = 4096;

// A canonical resource id: a UUID or a numeric id. Sub-action words like
// "invite", "bulk", "receipt", "delete", "done" are NOT ids.
const ID_PATTERN =
  /^([0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Parse "/api/orders/123/foo?x=1" -> { entity: "orders", entityId: "123" }.
function parsePath(originalUrl: string): { entity: string; entityId: string | null; path: string } {
  const path = originalUrl.split("?")[0] ?? originalUrl;
  const segments = path.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const entity = segments[0] ?? "";
  // Second segment is an id only when it looks like a canonical id (UUID/number),
  // not a sub-action word (e.g. /users/invite -> entityId null).
  const maybeId = segments[1];
  const entityId = maybeId && ID_PATTERN.test(maybeId) ? maybeId : null;
  return { entity, entityId, path };
}

// Keep a compact snapshot of the request body for create/update actions. Big
// payloads (e.g. bulk imports) are summarized instead of stored to avoid bloat.
function snapshotBody(body: unknown): unknown {
  if (body == null || typeof body !== "object") return undefined;
  try {
    const json = JSON.stringify(body);
    if (json.length > MAX_META_BYTES) {
      return { truncated: true, sizeBytes: json.length };
    }
    return body;
  } catch {
    return undefined;
  }
}

// Records every successful mutating request as an append-only audit entry.
// Runs after requireAuth (so req.appUser is set) and writes on response finish
// so it never blocks or fails the actual request.
export function auditLog(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const body = req.method === "DELETE" ? undefined : snapshotBody(req.body);

  res.on("finish", () => {
    // Only record changes that actually succeeded.
    if (res.statusCode >= 400) return;
    const user = req.appUser;
    if (!user) return;

    const { entity, entityId, path } = parsePath(req.originalUrl);

    void db
      .insert(auditLogTable)
      .values({
        userId: user.id,
        userEmail: user.email,
        userName: user.name ?? null,
        method: req.method,
        entity,
        entityId,
        path,
        statusCode: res.statusCode,
        meta: body ?? null,
      })
      .catch((err) => {
        req.log?.error({ err }, "Failed to write audit log entry");
      });
  });

  next();
}
