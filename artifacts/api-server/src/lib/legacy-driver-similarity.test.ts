import assert from "node:assert/strict";
import test from "node:test";

import {
  legacyDriverSimilarityKey,
  markSimilarLegacyDriverNames,
} from "./legacy-driver-similarity.ts";

function assignment(legacyName: string) {
  return {
    legacyName,
    siteCount: 1,
    deliveryCount: 2,
    totalCount: 3,
  };
}

test("кириллические имена с разным регистром попадают в одну группу", () => {
  const marked = markSimilarLegacyDriverNames([
    assignment("Иванов Иван"),
    assignment("иванов иван"),
  ]);

  assert.ok(marked[0].similarityGroup);
  assert.equal(marked[0].similarityGroup, marked[1].similarityGroup);
  assert.deepEqual(marked.map(({ legacyName, totalCount }) => ({ legacyName, totalCount })), [
    { legacyName: "Иванов Иван", totalCount: 3 },
    { legacyName: "иванов иван", totalCount: 3 },
  ]);
});

test("инициалы с пробелами и простой пунктуацией считаются похожими", () => {
  assert.equal(
    legacyDriverSimilarityKey("Иванов И.И."),
    legacyDriverSimilarityKey("иванов  и. и."),
  );

  const marked = markSimilarLegacyDriverNames([
    assignment("Иванов И.И."),
    assignment("иванов  и. и."),
  ]);
  assert.ok(marked.every((item) => item.similarityGroup !== null));
});

test("похожие, но разные фамилии не объединяются в группу", () => {
  const marked = markSimilarLegacyDriverNames([
    assignment("Иванов И. И."),
    assignment("Иваненко И. И."),
    assignment("Иванова И. И."),
  ]);

  assert.ok(marked.every((item) => item.similarityGroup === null));
});