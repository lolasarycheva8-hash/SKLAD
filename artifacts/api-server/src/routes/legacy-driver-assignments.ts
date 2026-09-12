import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  appUsersTable,
  db,
  deliveriesTable,
  legacyDriverSimilarityReviewsTable,
  sitesTable,
} from "@workspace/db";
import {
  GetLegacyDriverAssignmentsResponse,
  ResolveLegacyDriverAssignmentsBody,
  ResolveLegacyDriverAssignmentsResponse,
  SetLegacyDriverSimilarityReviewBody,
  SetLegacyDriverSimilarityReviewResponse,
} from "@workspace/api-zod";

import { requireAdmin } from "../middlewares/requirePermission";
import { markSimilarLegacyDriverNames } from "../lib/legacy-driver-similarity";

const router: IRouter = Router();

type AssignmentCounts = {
  siteCount: number;
  deliveryCount: number;
};

const LEGACY_EDGE_WHITESPACE = /^[ \t\n\r\f\v\u00a0]+|[ \t\n\r\f\v\u00a0]+$/gu;

function normalizeLegacyDriverName(value: string): string {
  return value.replace(LEGACY_EDGE_WHITESPACE, "");
}

function normalizedLegacyDriverSql(column: AnyPgColumn) {
  return sql<string>`btrim(${column}, chr(32) || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160))`;
}

async function listUnresolvedLegacyDriverCandidates() {
  const normalizedSiteDriver = normalizedLegacyDriverSql(
    sitesTable.legacyDriver,
  );
  const normalizedDeliveryDriver = normalizedLegacyDriverSql(
    deliveriesTable.legacyDriver,
  );
  const [siteRows, deliveryRows] = await Promise.all([
    db
      .select({
        legacyName: normalizedSiteDriver,
        count: sql<number>`count(*)::int`,
      })
      .from(sitesTable)
      .where(
        and(
          isNull(sitesTable.driverUserId),
          sql`${normalizedSiteDriver} <> ''`,
        ),
      )
      .groupBy(normalizedSiteDriver),
    db
      .select({
        legacyName: normalizedDeliveryDriver,
        count: sql<number>`count(*)::int`,
      })
      .from(deliveriesTable)
      .where(
        and(
          isNull(deliveriesTable.driverUserId),
          sql`${normalizedDeliveryDriver} <> ''`,
        ),
      )
      .groupBy(normalizedDeliveryDriver),
  ]);

  const counts = new Map<string, AssignmentCounts>();
  for (const row of siteRows) {
    counts.set(row.legacyName, {
      siteCount: row.count,
      deliveryCount: 0,
    });
  }
  for (const row of deliveryRows) {
    const existing = counts.get(row.legacyName);
    counts.set(row.legacyName, {
      siteCount: existing?.siteCount ?? 0,
      deliveryCount: row.count,
    });
  }

  const assignments = [...counts.entries()]
    .map(([legacyName, value]) => ({
      legacyName,
      siteCount: value.siteCount,
      deliveryCount: value.deliveryCount,
      totalCount: value.siteCount + value.deliveryCount,
    }))
    .sort((left, right) => left.legacyName.localeCompare(right.legacyName, "ru"));

  return markSimilarLegacyDriverNames(assignments);
}

function legacyNamesForSimilarityGroup(
  candidates: Awaited<ReturnType<typeof listUnresolvedLegacyDriverCandidates>>,
  similarityGroup: string,
) {
  return candidates
    .filter((candidate) => candidate.similarityGroup === similarityGroup)
    .map((candidate) => candidate.legacyName)
    .sort((left, right) => left.localeCompare(right, "ru"));
}

async function listUnresolvedLegacyDriverAssignments() {
  const candidates = await listUnresolvedLegacyDriverCandidates();
  const similarityGroups = [
    ...new Set(
      candidates
        .map((candidate) => candidate.similarityGroup)
        .filter((group): group is string => group !== null),
    ),
  ];
  const reviewedRows =
    similarityGroups.length === 0
      ? []
      : await db
          .select({
            similarityGroup: legacyDriverSimilarityReviewsTable.similarityGroup,
            legacyNames: legacyDriverSimilarityReviewsTable.legacyNames,
            reviewedAt: legacyDriverSimilarityReviewsTable.reviewedAt,
            reviewedByName: appUsersTable.name,
            reviewedByNameSnapshot:
              legacyDriverSimilarityReviewsTable.reviewedByNameSnapshot,
            reviewedByDeleted: isNull(appUsersTable.id),
          })
          .from(legacyDriverSimilarityReviewsTable)
          .leftJoin(
            appUsersTable,
            eq(legacyDriverSimilarityReviewsTable.reviewedBy, appUsersTable.id),
          )
          .where(
            inArray(
              legacyDriverSimilarityReviewsTable.similarityGroup,
              similarityGroups,
            ),
          );
  const reviewsByGroup = new Map(
    reviewedRows.map((row) => [row.similarityGroup, row]),
  );

  return candidates.map((candidate) => {
    const review =
      candidate.similarityGroup === null
        ? undefined
        : reviewsByGroup.get(candidate.similarityGroup);
    const similarityReviewed =
      candidate.similarityGroup !== null &&
      JSON.stringify(review?.legacyNames) ===
        JSON.stringify(
          legacyNamesForSimilarityGroup(candidates, candidate.similarityGroup),
        );

    return {
      ...candidate,
      similarityReviewed,
      similarityReviewedAt: similarityReviewed ? review!.reviewedAt : null,
      similarityReviewedByName: similarityReviewed
        ? (review!.reviewedByNameSnapshot ?? review!.reviewedByName)
        : null,
      similarityReviewedByDeleted: similarityReviewed
        ? review!.reviewedByDeleted
        : false,
    };
  });
}

router.get(
  "/admin/legacy-driver-assignments",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const assignments = await listUnresolvedLegacyDriverAssignments();
    res.json(GetLegacyDriverAssignmentsResponse.parse(assignments));
  },
);

router.post(
  "/admin/legacy-driver-assignments",
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = ResolveLegacyDriverAssignmentsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const mappings = body.data.mappings
      .map((mapping) => ({
        legacyName: normalizeLegacyDriverName(mapping.legacyName),
        driverUserId: mapping.driverUserId,
      }))
      .sort((left, right) =>
        left.legacyName.localeCompare(right.legacyName, "ru"),
      );

    const names = new Set<string>();
    for (const mapping of mappings) {
      if (
        mapping.legacyName.length === 0 ||
        names.has(mapping.legacyName)
      ) {
        res.status(400).json({
          error: "Каждое старое имя водителя должно быть непустым и уникальным",
        });
        return;
      }
      names.add(mapping.legacyName);
    }

    const result = await db.transaction(async (tx) => {
      const requestedDriverIds = [
        ...new Set(mappings.map((mapping) => mapping.driverUserId)),
      ];
      const validDrivers = await tx
        .select({ id: appUsersTable.id })
        .from(appUsersTable)
        .where(
          and(
            inArray(appUsersTable.id, requestedDriverIds),
            or(
              eq(appUsersTable.role, "driver"),
              eq(appUsersTable.isDriver, true),
            ),
          ),
        )
        .for("share");
      const validDriverIds = new Set(validDrivers.map((driver) => driver.id));
      const invalidDriverIds = requestedDriverIds.filter(
        (driverId) => !validDriverIds.has(driverId),
      );
      if (invalidDriverIds.length > 0) {
        return { invalidDriverIds } as const;
      }

      const results = [];
      for (const mapping of mappings) {
        const updatedSites = await tx
          .update(sitesTable)
          .set({ driverUserId: mapping.driverUserId })
          .where(
            and(
              isNull(sitesTable.driverUserId),
              sql`${normalizedLegacyDriverSql(sitesTable.legacyDriver)} = ${mapping.legacyName}`,
            ),
          )
          .returning({ id: sitesTable.id });
        const updatedDeliveries = await tx
          .update(deliveriesTable)
          .set({ driverUserId: mapping.driverUserId })
          .where(
            and(
              isNull(deliveriesTable.driverUserId),
              sql`${normalizedLegacyDriverSql(deliveriesTable.legacyDriver)} = ${mapping.legacyName}`,
            ),
          )
          .returning({ id: deliveriesTable.id });

        results.push({
          legacyName: mapping.legacyName,
          driverUserId: mapping.driverUserId,
          siteCount: updatedSites.length,
          deliveryCount: updatedDeliveries.length,
          totalCount: updatedSites.length + updatedDeliveries.length,
        });
      }

      const sitesUpdated = results.reduce(
        (total, item) => total + item.siteCount,
        0,
      );
      const deliveriesUpdated = results.reduce(
        (total, item) => total + item.deliveryCount,
        0,
      );
      return {
        results,
        sitesUpdated,
        deliveriesUpdated,
        totalUpdated: sitesUpdated + deliveriesUpdated,
      } as const;
    });

    if ("invalidDriverIds" in result) {
      res.status(400).json({
        error: "Выбранный пользователь не является водителем",
      });
      return;
    }

    res.json(ResolveLegacyDriverAssignmentsResponse.parse(result));
  },
);

router.put(
  "/admin/legacy-driver-similarity-reviews",
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = SetLegacyDriverSimilarityReviewBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    if (body.data.reviewed) {
      const candidates = await listUnresolvedLegacyDriverCandidates();
      const legacyNames = legacyNamesForSimilarityGroup(
        candidates,
        body.data.similarityGroup,
      );
      if (legacyNames.length < 2) {
        res.status(400).json({
          error: "Группа вероятных дублей больше не существует",
        });
        return;
      }

      await db
        .insert(legacyDriverSimilarityReviewsTable)
        .values({
          similarityGroup: body.data.similarityGroup,
          legacyNames,
          reviewedBy: req.appUser!.id,
          reviewedByNameSnapshot: req.appUser!.name,
        })
        .onConflictDoUpdate({
          target: legacyDriverSimilarityReviewsTable.similarityGroup,
          set: {
            legacyNames,
            reviewedAt: new Date(),
            reviewedBy: req.appUser!.id,
            reviewedByNameSnapshot: req.appUser!.name,
          },
        });
    } else {
      await db
        .delete(legacyDriverSimilarityReviewsTable)
        .where(
          eq(
            legacyDriverSimilarityReviewsTable.similarityGroup,
            body.data.similarityGroup,
          ),
        );
    }

    res.json(
      SetLegacyDriverSimilarityReviewResponse.parse({
        similarityGroup: body.data.similarityGroup,
        reviewed: body.data.reviewed,
      }),
    );
  },
);

export default router;