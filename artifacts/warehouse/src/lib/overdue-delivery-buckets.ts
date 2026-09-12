export const OVERDUE_BUCKET_IDS = [
  "overdue-under-3",
  "overdue-3-to-5",
  "overdue-over-5",
] as const;

export type OverdueBucketId = (typeof OVERDUE_BUCKET_IDS)[number];

export type OverdueDeliveryBucket = {
  id: OverdueBucketId;
  label: string;
  count: number;
  percent: number;
};

export function isOverdueBucketId(
  value: string | null,
): value is OverdueBucketId {
  return OVERDUE_BUCKET_IDS.includes(value as OverdueBucketId);
}

export function matchesOverdueBucket(
  lagDays: number | null,
  bucketId: OverdueBucketId,
): boolean {
  if (lagDays === null || lagDays <= 0) return false;
  if (bucketId === "overdue-under-3") return lagDays < 3;
  if (bucketId === "overdue-3-to-5") return lagDays >= 3 && lagDays <= 5;
  return lagDays > 5;
}

export function createOverdueDeliveryBuckets(
  deliveries: ReadonlyArray<{ lagDays: number | null }>,
  plannedDeliveryCount: number,
): OverdueDeliveryBucket[] {
  const overdueDeliveries = deliveries.filter(
    ({ lagDays }) => lagDays !== null && lagDays > 0,
  );
  const definitions: Array<Pick<OverdueDeliveryBucket, "id" | "label">> = [
    { id: "overdue-under-3", label: "Просрочено менее 3 дней" },
    { id: "overdue-3-to-5", label: "Просрочено 3–5 дней" },
    { id: "overdue-over-5", label: "Просрочено более 5 дней" },
  ];

  return definitions.map(({ id, label }) => {
    const count = overdueDeliveries.filter(({ lagDays }) =>
      matchesOverdueBucket(lagDays, id),
    ).length;
    return {
      id,
      label,
      count,
      percent:
        plannedDeliveryCount > 0 ? (count / plannedDeliveryCount) * 100 : 0,
    };
  });
}