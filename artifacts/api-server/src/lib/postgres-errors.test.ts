import assert from "node:assert/strict";
import test from "node:test";

import { isPostgresConstraintError } from "./postgres-errors.ts";

const expected = {
  code: "23503",
  constraint: "shipments_driver_user_id_app_users_id_fk",
};

test("recognizes matching PostgreSQL fields on the direct error", () => {
  assert.equal(isPostgresConstraintError(expected, expected), true);
});

test("recognizes matching PostgreSQL fields through nested causes", () => {
  assert.equal(
    isPostgresConstraintError(
      {
        cause: {
          cause: expected,
        },
      },
      expected,
    ),
    true,
  );
});

test("rejects unrelated PostgreSQL codes and constraints", () => {
  assert.equal(
    isPostgresConstraintError(
      {
        code: "23505",
        constraint: expected.constraint,
      },
      expected,
    ),
    false,
  );
  assert.equal(
    isPostgresConstraintError(
      {
        code: expected.code,
        constraint: "another_foreign_key",
      },
      expected,
    ),
    false,
  );
});