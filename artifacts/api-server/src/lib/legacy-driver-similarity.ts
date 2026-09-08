export type LegacyDriverAssignmentCounts = {
  legacyName: string;
  siteCount: number;
  deliveryCount: number;
  totalCount: number;
};

const SIMPLE_NAME_SEPARATORS = /[\p{P}\p{Z}\s]+/gu;

export function legacyDriverSimilarityKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(SIMPLE_NAME_SEPARATORS, "");
}

export function markSimilarLegacyDriverNames<
  T extends LegacyDriverAssignmentCounts,
>(assignments: T[]): Array<T & { similarityGroup: string | null }> {
  const groupSizes = new Map<string, number>();

  for (const assignment of assignments) {
    const key = legacyDriverSimilarityKey(assignment.legacyName);
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  }

  return assignments.map((assignment) => {
    const key = legacyDriverSimilarityKey(assignment.legacyName);
    return {
      ...assignment,
      similarityGroup: (groupSizes.get(key) ?? 0) > 1 ? key : null,
    };
  });
}