export type PostgresConstraintErrorMatch = Readonly<{
  code: string;
  constraint: string;
}>;

export function isPostgresConstraintError(
  error: unknown,
  expected: PostgresConstraintErrorMatch,
): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if (
      "code" in current &&
      current.code === expected.code &&
      "constraint" in current &&
      current.constraint === expected.constraint
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}