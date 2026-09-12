import {
  createStorageFailureLogFields,
  sanitizePrivateStorageObjectPath as sanitizePath,
  sanitizePrivateStorageRequestUrl,
  sanitizePrivateStorageText as sanitizeText,
} from "../../src/lib/storage-log-sanitizer";
import * as storage from "../../src/lib/storage-log-sanitizer.ts";
import { buildFields } from "./helpers";
import { recordBulkSiteImportSlowWarning as recordWarning } from "../../src/lib/bulk-site-import-slow-store";

declare const logger: { error(fields: unknown, message?: string): void };
const objectPath = "/objects/uploads/private-fixture";

logger.error(createStorageFailureLogFields({
  operation: "delete",
  error: new Error("failed"),
  objectPath,
}), "approved builder");
logger.error({ objectPath: sanitizePath(objectPath) }, "renamed sanitizer");
logger.error({ uploadURL: sanitizePrivateStorageRequestUrl(objectPath) }, "URL sanitizer");
logger.error(sanitizeText(objectPath));
logger.error(storage.createStorageFailureLogFields({
  operation: "read",
  error: new Error("failed"),
  objectPath,
}), "namespace builder");
logger.error({ rawPath: storage["sanitizePrivateStorageObjectPath"](objectPath) });
const approvedAlias = storage.createStorageFailureLogFields;
logger.error(approvedAlias({ operation: "read", error: new Error("failed") }));
logger.error({ retryCount: 2 }, sanitizeText(objectPath));

// Importing or calling an unknown helper outside a logger isn't a violation.
const unrelatedFields = buildFields();
void unrelatedFields;

async function logReviewedMetrics() {
  const signal = await recordWarning({
    phase: "write",
    rowCount: 10,
    durationMs: 5_000,
    thresholdMs: 2_000,
    minimumRowsPerSecond: 50,
  });
  logger.error(signal, "reviewed numeric metrics");
}
void logReviewedMetrics;

const { createStorageFailureLogFields: destructuredBuilder } = storage;
const container = { builder: destructuredBuilder };
logger.error(container.builder({ operation: "read", error: new Error("failed") }));
const box = { fields: createStorageFailureLogFields({
  operation: "read",
  error: new Error("failed"),
}) };
logger.error(box.fields);
const [arrayBuilder] = [createStorageFailureLogFields];
logger.error(arrayBuilder({ operation: "read", error: new Error("failed") }));

let objectAlias: typeof createStorageFailureLogFields;
({ createStorageFailureLogFields: objectAlias } = storage);
logger.error(objectAlias({ operation: "read", error: new Error("failed") }));
let assignedArrayAlias: typeof createStorageFailureLogFields;
[assignedArrayAlias] = [createStorageFailureLogFields];
logger.error(assignedArrayAlias({ operation: "read", error: new Error("failed") }));
const holder = {} as { fn: typeof createStorageFailureLogFields };
holder.fn = createStorageFailureLogFields;
logger.error(holder.fn({ operation: "read", error: new Error("failed") }));

let reassignedFields: object = {};
reassignedFields = createStorageFailureLogFields({
  operation: "read",
  error: new Error("failed"),
});
logger.error(reassignedFields);
const resultHolder = {} as { fields: object };
resultHolder.fields = {};
resultHolder.fields = createStorageFailureLogFields({
  operation: "read",
  error: new Error("failed"),
});
logger.error(resultHolder.fields);

function withDefault(defaultFields = createStorageFailureLogFields({
  operation: "read",
  error: new Error("failed"),
})) {
  logger.error(defaultFields);
}
const { defaultResult = createStorageFailureLogFields({
  operation: "read",
  error: new Error("failed"),
}) } = {} as { defaultResult?: object };
logger.error(defaultResult);
void withDefault;

class FieldLogger {
  fields = createStorageFailureLogFields({
    operation: "read",
    error: new Error("failed"),
  });
  log() {
    logger.error(this.fields);
  }
}
class ConstructorLogger {
  constructorFields: object;
  constructor() {
    this.constructorFields = createStorageFailureLogFields({
      operation: "read",
      error: new Error("failed"),
    });
  }
  log() {
    logger.error(this.constructorFields);
  }
}
void FieldLogger;
void ConstructorLogger;