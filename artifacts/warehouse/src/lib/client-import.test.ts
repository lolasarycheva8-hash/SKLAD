import assert from "node:assert/strict";
import test from "node:test";

import { resolveImportClient } from "./client-import.ts";

test("Excel import resolves a client by one normalized name match", () => {
  const client = resolveImportClient(
    [
      { id: "client-1", name: "Первый клиент" },
      { id: "client-2", name: "Второй клиент" },
    ],
    "  ПЕРВЫЙ КЛИЕНТ ",
  );
  assert.deepEqual(client, { id: "client-1", name: "Первый клиент" });
});

test("Excel import matches API-normalized clients across Unicode whitespace", () => {
  const clients = [
    { id: "client-1", name: "Первый клиент" },
    { id: "client-2", name: "Второй клиент" },
  ];
  const importedNames = [
    "ПЕРВЫЙ\u00A0КЛИЕНТ",
    "ПЕРВЫЙ\tКЛИЕНТ",
    "ПЕРВЫЙ\u2009КЛИЕНТ",
    "\u3000ПЕРВЫЙ \t\u00A0\u202F КЛИЕНТ\uFEFF",
    "ПЕР\u200BВЫЙ КЛИЕНТ",
    "ПЕР\u200CВЫЙ КЛИЕНТ",
    "ПЕР\u200DВЫЙ КЛИЕНТ",
    "ПЕР\u2060ВЫЙ КЛИЕНТ",
  ];

  for (const importedName of importedNames) {
    assert.deepEqual(resolveImportClient(clients, importedName), clients[0]);
  }
});

test("Excel import rejects a missing client", () => {
  assert.throws(
    () =>
      resolveImportClient(
        [{ id: "client-1", name: "Первый клиент" }],
        "Неизвестный клиент",
      ),
    /не найден в справочнике/,
  );
});

test("Excel import rejects an ambiguous client name", () => {
  assert.throws(
    () =>
      resolveImportClient(
        [
          { id: "client-1", name: "Первый клиент" },
          { id: "client-2", name: "\u00A0первый\tклиент\u3000" },
        ],
        "Первый клиент",
      ),
    /сопоставляется неоднозначно/,
  );
});