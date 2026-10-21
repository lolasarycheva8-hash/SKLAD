import { describe, expect, it } from "vitest";
import type { Delivery } from "@workspace/api-client-react";
import {
  buildBulkDeliveryUpdateInput,
  getBulkDeliveryEligibility,
  matchesBulkDeliveryScope,
  UNASSIGNED_DRIVER_FILTER,
  type BulkDeliveryRow,
} from "./delivery-bulk-edit-dialog";

function row(
  id: string,
  overrides: Partial<Delivery> = {},
): BulkDeliveryRow {
  return {
    id,
    siteId: `site-${id}`,
    siteBranch: "Север",
    actualDate: null,
    workflowStatus: "active",
    parentDeliveryId: null,
    ...overrides,
  } as BulkDeliveryRow;
}

describe("getBulkDeliveryEligibility", () => {
  it("requires both selected branch and stable driver UUID to match", () => {
    const candidate = {
      siteBranch: "Север",
      driverUserId: "driver-a",
    };

    expect(
      matchesBulkDeliveryScope(candidate, "Север", "driver-a"),
    ).toBe(true);
    expect(
      matchesBulkDeliveryScope(candidate, "Юг", "driver-a"),
    ).toBe(false);
    expect(
      matchesBulkDeliveryScope(candidate, "Север", "driver-b"),
    ).toBe(false);
  });

  it("matches the explicit unassigned filter only to null driver IDs", () => {
    expect(
      matchesBulkDeliveryScope(
        { siteBranch: "Север", driverUserId: null },
        "",
        UNASSIGNED_DRIVER_FILTER,
      ),
    ).toBe(true);
    expect(
      matchesBulkDeliveryScope(
        { siteBranch: "Север", driverUserId: "driver-a" },
        "",
        UNASSIGNED_DRIVER_FILTER,
      ),
    ).toBe(false);
  });

  it("uses the complete filtered collection beyond the 500-row page boundary", () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      row(String(index + 1)),
    );

    const result = getBulkDeliveryEligibility(rows);

    expect(result.eligible).toHaveLength(501);
    expect(result.eligible.at(-1)?.id).toBe("501");
  });

  it("excludes completed and closed rows and counts unique objects", () => {
    const rows = [
      row("primary", { siteId: "site-one" }),
      row("additional", {
        siteId: "site-one",
        parentDeliveryId: "primary",
      }),
      row("completed", { actualDate: "2026-03-10" }),
      row("closed", { workflowStatus: "closed" }),
    ];

    const result = getBulkDeliveryEligibility(rows);

    expect(result.eligible.map(({ id }) => id)).toEqual([
      "primary",
      "additional",
    ]);
    expect(result.excluded).toBe(2);
    expect(result.uniqueSites).toBe(1);
  });

  it("builds exactly one driver change with optimistic snapshots", () => {
    const input = buildBulkDeliveryUpdateInput(
      [
        row("one", {
          driverUserId: "old-driver",
          plannedDate: "2026-03-08T00:00:00.000Z",
        }),
      ],
      { operation: "driver", driverUserId: null },
    );

    expect(input).toEqual({
      deliveries: [
        {
          id: "one",
          expectedDriverUserId: "old-driver",
          expectedPlannedDate: "2026-03-08",
        },
      ],
      driverUserId: null,
    });
    expect(input).not.toHaveProperty("plannedDate");
  });

  it("builds exactly one planned-date change", () => {
    const input = buildBulkDeliveryUpdateInput(
      [row("one", { driverUserId: null, plannedDate: null })],
      { operation: "date", plannedDate: "2026-03-20" },
    );

    expect(input).toEqual({
      deliveries: [
        {
          id: "one",
          expectedDriverUserId: null,
          expectedPlannedDate: null,
        },
      ],
      plannedDate: "2026-03-20",
    });
    expect(input).not.toHaveProperty("driverUserId");
  });
});