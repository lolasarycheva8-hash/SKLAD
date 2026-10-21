import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { findUnsafeStorageLoggerFields } from "./storage-log-policy.ts";
import {
  BULK_SITE_IMPORT_LOG_FIELD_NAMES,
  BULK_SITE_IMPORT_SLOW_WARNING_FIELD_NAMES,
  createBulkSiteImportSlowWarning,
  getBulkSiteImportSlowThresholdMs,
  type BulkSiteImportLogFields,
} from "./bulk-site-import-log.ts";

const EXPECTED_BULK_SITE_IMPORT_LOG_FIELDS = [
  "rowCount",
  "writeBatchCount",
  "validationDurationMs",
  "writeDurationMs",
  "totalDurationMs",
  "succeeded",
];

test("bulk-импорт логирует только разрешённые безопасные числовые поля", () => {
  const representativeFields: BulkSiteImportLogFields = {
    rowCount: 250,
    writeBatchCount: 3,
    validationDurationMs: 12.5,
    writeDurationMs: 84.25,
    totalDurationMs: 97,
    succeeded: 1,
  };
  assert.deepEqual(
    Object.keys(representativeFields),
    EXPECTED_BULK_SITE_IMPORT_LOG_FIELDS,
  );
  assert.ok(
    Object.values(representativeFields).every((value) => typeof value === "number"),
  );
  assert.deepEqual(
    [...BULK_SITE_IMPORT_LOG_FIELD_NAMES],
    EXPECTED_BULK_SITE_IMPORT_LOG_FIELDS,
  );
});

test("пороги замедления bulk-импорта учитывают фазу и число строк", () => {
  assert.equal(getBulkSiteImportSlowThresholdMs("validation", 0), 1_000);
  assert.equal(getBulkSiteImportSlowThresholdMs("validation", 200), 2_000);
  assert.equal(getBulkSiteImportSlowThresholdMs("validation", 1_000), 6_000);
  assert.equal(getBulkSiteImportSlowThresholdMs("write", 0), 2_000);
  assert.equal(getBulkSiteImportSlowThresholdMs("write", 50), 3_000);
  assert.equal(getBulkSiteImportSlowThresholdMs("write", 1_000), 22_000);
});

test("предупреждает только при строгом превышении размерозависимого порога", () => {
  assert.equal(createBulkSiteImportSlowWarning("validation", 0, 20_000), null);
  assert.equal(createBulkSiteImportSlowWarning("validation", 200, 2_000), null);
  assert.equal(createBulkSiteImportSlowWarning("write", 50, 3_000), null);

  assert.deepEqual(createBulkSiteImportSlowWarning("validation", 200, 2_001), {
    phase: "validation",
    rowCount: 200,
    durationMs: 2_001,
    thresholdMs: 2_000,
    minimumRowsPerSecond: 200,
  });
  assert.deepEqual(createBulkSiteImportSlowWarning("write", 50, 3_001), {
    phase: "write",
    rowCount: 50,
    durationMs: 3_001,
    thresholdMs: 3_000,
    minimumRowsPerSecond: 50,
  });
});

test("предупреждение о замедлении содержит только безопасные поля", () => {
  const warning = createBulkSiteImportSlowWarning("write", 100, 4_001);
  assert.ok(warning);
  assert.deepEqual(
    Object.keys(warning),
    [...BULK_SITE_IMPORT_SLOW_WARNING_FIELD_NAMES],
  );
  assert.ok(
    Object.entries(warning).every(
      ([name, value]) =>
        (name === "phase" && (value === "validation" || value === "write")) ||
        (name !== "phase" && typeof value === "number"),
    ),
  );
});

async function listProductionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listProductionTypeScriptFiles(fullPath)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

test("отклоняет прямые приватные Storage-поля в структурированных logger-вызовах", () => {
  const violations = findUnsafeStorageLoggerFields(
    `
      req.log.error({ objectPath }, "delete failed");
      logger.warn({
        storage: { rawPath: request.path },
      }, "unsafe path");
      dependencies.logger.info({
        uploadURL: result.uploadURL,
      }, "upload allocated");
      const delayedFields = { objectPath: photo.objectPath };
      req.log.warn(delayedFields, "delayed delete");
    `,
    "unsafe-storage-logger.fixture.ts",
  );

  assert.deepEqual(
    violations.map(({ fieldName }) => fieldName),
    ["objectPath", "rawPath", "uploadURL", "objectPath"],
  );
  assert.ok(violations.every(({ line, column }) => line > 0 && column > 0));
});

test("разрешает безопасный builder и явные Storage-sanitizer-вызовы", () => {
  const violations = findUnsafeStorageLoggerFields(
    `
      req.log.error(
        createStorageFailureLogFields({ operation, error, objectPath }),
        "storage failed",
      );
      logger.debug({
        objectPath: sanitizePrivateStorageObjectPath(objectPath),
      }, "storage object processed");
      dependencies.logger.error(
        sanitizeCleanupFailureForLog({ objectPath, error }),
        "cleanup failed",
      );
    `,
    "safe-storage-logger.fixture.ts",
  );

  assert.deepEqual(violations, []);
});

test("отклоняет локальные helper-функции с приватными Storage-полями", () => {
  const violations = findUnsafeStorageLoggerFields(
    `
      function createUnsafeFields(path: string) {
        return { operation: "delete", objectPath: path };
      }
      const createUnsafeUploadFields = (url: string) => ({
        status: "failed",
        uploadURL: url,
      });
      const createNestedUnsafeFields = function (path: string) {
        return { storage: { rawPath: path } };
      };

      logger.error(createUnsafeFields(path), "delete failed");
      req.log.warn(createUnsafeUploadFields(url), "upload failed");
      dependencies.logger.info(
        createNestedUnsafeFields(path),
        "read failed",
      );
    `,
    "unsafe-storage-logger-helper.fixture.ts",
  );

  assert.deepEqual(
    violations.map(({ fieldName }) => fieldName),
    ["objectPath", "uploadURL", "rawPath"],
  );
});

test("разрешает утверждённые builders и обычные поля локальных helpers", () => {
  const violations = findUnsafeStorageLoggerFields(
    `
      function createOrdinaryFields(operation: string) {
        return { operation, status: "failed", retryCount: 2 };
      }
      const sanitizePrivateStoragePretender = () => ({ objectPath });

      logger.error(
        createStorageFailureLogFields({ operation, error, objectPath }),
        "storage failed",
      );
      req.log.warn(
        sanitizeCleanupFailureForLog({ objectPath, error }),
        "cleanup failed",
      );
      logger.info(createOrdinaryFields("read"), "ordinary failure");
      logger.error(
        sanitizePrivateStoragePretender(),
        "fake sanitizer must not bypass policy",
      );
    `,
    "storage-logger-helper-allow-list.fixture.ts",
  );

  assert.deepEqual(
    violations.map(({ fieldName }) => fieldName),
    ["objectPath"],
  );
});

test("отклоняет непрозрачные межфайловые builders, включая псевдонимы и поддельные sanitizer-имена", async () => {
  const fileName = path.resolve(
    import.meta.dirname,
    "../../test-fixtures/storage-log-policy/unsafe.fixture.ts",
  );
  const source = await readFile(fileName, "utf8");
  const violations = findUnsafeStorageLoggerFields(source, fileName);

  assert.deepEqual(violations.map(({ fieldName }) => fieldName), [
    "renamedBuilder",
    "createStorageFailureLogFields",
    "builders.buildFields",
    'builders["buildFields"]',
    "builders.createStorageFailureLogFields",
    "sanitizePrivateStoragePretender",
    "buildOrdinaryFields",
    "alias",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "buildFields",
    "spoofed",
    "container.createStorageFailureLogFields",
    "renamedBuilder",
    "renamedBuilder",
    "arrayBuilder",
    "renamedBuilder",
    "selected",
    "conditional",
    "(0, renamedBuilder)",
    "bound",
    "objectAlias",
    "arrayAlias",
    "holder.fn",
    'holder["fn"]',
    "opaqueHolder.fn",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "renamedBuilder",
    "(renamedBuilder as any)",
    "renamedBuilder",
    "renamedBuilder",
  ]);
  for (const violation of violations) {
    assert.equal(violation.fileName, fileName);
    assert.match(violation.message, /Импортированный helper .* из \.\/helpers|Непроверенный helper/);
    assert.match(violation.message, /утверждённый Storage-builder/);
    assert.ok(source.split("\n")[violation.line - 1].slice(violation.column - 1)
      .startsWith(violation.fieldName));
  }
});

test("разрешает только утверждённые экспорты точного модуля, в том числе с псевдонимами", async () => {
  const fileName = path.resolve(
    import.meta.dirname,
    "../../test-fixtures/storage-log-policy/safe.fixture.ts",
  );
  assert.deepEqual(
    findUnsafeStorageLoggerFields(await readFile(fileName, "utf8"), fileName),
    [],
  );
});

test("одноимённый экспорт другого модуля не получает доверие Storage-sanitizer", () => {
  const fileName = path.resolve(import.meta.dirname, "imports.fixture.ts");
  for (const moduleName of [
    "./other/storage-log-sanitizer",
    "storage-log-sanitizer",
    "./storage-log-sanitizer-copy",
  ]) {
    const violations = findUnsafeStorageLoggerFields(`
      import { createStorageFailureLogFields } from "${moduleName}";
      logger.error(createStorageFailureLogFields(), "unsafe");
    `, fileName);
    assert.equal(violations.length, 1, moduleName);
    assert.match(violations[0].message, /Импортированный helper/);
  }
});

test("поддельный импортированный текстовый sanitizer не скрывает приватный аргумент", () => {
  const violations = findUnsafeStorageLoggerFields(`
    import { sanitizePrivateStorageText } from "./helpers";
    logger.error({}, sanitizePrivateStorageText(objectPath));
  `);
  assert.deepEqual(violations.map(({ fieldName }) => fieldName), ["objectPath"]);
});

test("доверие не распространяется на другие экспорты модуля или динамический доступ", () => {
  const fileName = path.resolve(import.meta.dirname, "imports.fixture.ts");
  const violations = findUnsafeStorageLoggerFields(`
    import defaultBuilder, { unknownBuilder } from "./storage-log-sanitizer";
    import * as storage from "./storage-log-sanitizer";
    logger.error(defaultBuilder(), "default is not approved");
    logger.error(unknownBuilder(), "export is not approved");
    logger.error(storage[method](), "dynamic export cannot be verified");
  `, fileName);
  assert.deepEqual(violations.map(({ fieldName }) => fieldName), [
    "defaultBuilder", "unknownBuilder", "storage[method]",
  ]);
});

test("утверждённый builder метрик не становится sanitizer для приватных полей", () => {
  const fileName = path.resolve(import.meta.dirname, "imports.fixture.ts");
  const violations = findUnsafeStorageLoggerFields(`
    import { recordBulkSiteImportSlowWarning } from "./bulk-site-import-slow-store";
    logger.error({ objectPath: recordBulkSiteImportSlowWarning(warning) });
  `, fileName);
  assert.deepEqual(violations.map(({ fieldName }) => fieldName), ["objectPath"]);
});

test("отклоняет приватные Storage-значения в текстовых logger-сообщениях", () => {
  const violations = findUnsafeStorageLoggerFields(
    `
      logger.error(\`delete failed for \${objectPath}\`);
      req.log.warn("upload failed: " + result.uploadURL);
      dependencies.logger.info(
        { operation: "read" },
        \`read failed for \${request.rawPath}\`,
      );
      logger.debug(objectPath);
    `,
    "unsafe-storage-logger-text.fixture.ts",
  );

  assert.deepEqual(
    violations.map(({ fieldName }) => fieldName),
    ["objectPath", "uploadURL", "rawPath", "objectPath"],
  );
  assert.ok(violations.every(({ line, column }) => line > 0 && column > 0));
});

test("разрешает явно санитизированные Storage-значения в logger-сообщениях", () => {
  const violations = findUnsafeStorageLoggerFields(
    `
      logger.error(
        \`delete failed for \${sanitizePrivateStorageText(objectPath)}\`,
      );
      req.log.warn(
        "upload failed: " + sanitizePrivateStorageText(result.uploadURL),
      );
      dependencies.logger.info(
        { operation: "read" },
        sanitizePrivateStorageText(request.rawPath),
      );
    `,
    "safe-storage-logger-text.fixture.ts",
  );

  assert.deepEqual(violations, []);
});

test("production-маршруты и сервисы не логируют сырые Storage-пути", async () => {
  const sourceRoot = path.resolve(import.meta.dirname, "..");
  const directories = ["routes", "lib", "scripts"].map((directory) =>
    path.join(sourceRoot, directory),
  );
  const files = (
    await Promise.all(directories.map(listProductionTypeScriptFiles))
  ).flat();
  const violations = [];

  for (const file of files) {
    violations.push(
      ...findUnsafeStorageLoggerFields(
        await readFile(file, "utf8"),
        file,
      ),
    );
  }

  assert.deepEqual(
    violations,
    [],
    violations
      .map(
        ({ fileName, line, column, message }) =>
          `${fileName}:${line}:${column} ${message}`,
      )
      .join("\n"),
  );
});