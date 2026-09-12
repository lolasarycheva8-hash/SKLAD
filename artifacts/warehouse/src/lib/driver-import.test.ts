import assert from "node:assert/strict";
import test from "node:test";
import {
  getImportDriverOptions,
  resolveImportDriver,
} from "./driver-import.ts";

const drivers = [
  { id: "one", name: "Иван Иванов", email: "ivan.one@example.test" },
  { id: "two", name: "Иван Иванов", email: "ivan.two@example.test" },
];

test("Excel import выбирает водителя по уникальному email", () => {
  assert.equal(
    resolveImportDriver(drivers, "Иван Иванов", "ivan.two@example.test")?.id,
    "two",
  );
});

test("Excel import отклоняет неоднозначное имя водителя", () => {
  assert.throws(
    () => resolveImportDriver(drivers, "Иван Иванов", ""),
    /неоднозначно/,
  );
});

test("одинаковые ФИО получают однозначные варианты выпадающего списка", () => {
  const options = getImportDriverOptions(drivers);
  assert.deepEqual(
    options.map((option) => option.label),
    [
      "Иван Иванов — ivan.one@example.test",
      "Иван Иванов — ivan.two@example.test",
    ],
  );
  assert.equal(resolveImportDriver(drivers, options[1].label)?.id, "two");
});