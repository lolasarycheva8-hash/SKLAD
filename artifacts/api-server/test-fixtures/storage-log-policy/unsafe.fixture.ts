import createStorageFailureLogFields, {
  buildFields as renamedBuilder,
  buildOrdinaryFields,
  sanitizePrivateStoragePretender,
} from "./helpers";
import * as builders from "./helpers";

declare const logger: { error(fields: unknown, message: string): void };

logger.error(renamedBuilder(), "named import");
logger.error(createStorageFailureLogFields(), "default import with trusted name");
logger.error(builders.buildFields(), "namespace import");
logger.error(builders["buildFields"](), "namespace element access");
logger.error(builders.createStorageFailureLogFields(), "namespace trusted name spoof");
logger.error(sanitizePrivateStoragePretender(), "prefix is not an allow-list");
logger.error(buildOrdinaryFields(), "opaque even if implementation looks safe");

const alias = renamedBuilder;
logger.error(alias(), "local function alias");
const delayedFields = renamedBuilder();
logger.error(delayedFields, "delayed fields");
logger.error({ ...renamedBuilder() }, "spread");
logger.error({ storage: renamedBuilder() }, "nested fields");
logger.error({ delayedFields }, "nested shorthand");
const wrapper = () => renamedBuilder();
logger.error(wrapper(), "local wrapper");
logger.error(true ? renamedBuilder() : {}, "conditional");
logger.error(delayedFields || {}, "logical expression");
logger.error((renamedBuilder() satisfies object), "satisfies");

async function logAsync() {
  logger.error(await renamedBuilder(), "awaited builder");
}
void logAsync;

const { buildFields, createStorageFailureLogFields: spoofed } = builders;
logger.error(buildFields(), "destructured namespace");
logger.error(spoofed(), "destructured trusted-looking export");
const container = { createStorageFailureLogFields: renamedBuilder };
logger.error(container.createStorageFailureLogFields(), "object container");
const box = { fields: renamedBuilder() };
logger.error(box.fields, "object member result");
const { fields } = box;
logger.error(fields, "destructured result");
const [arrayBuilder] = [renamedBuilder];
logger.error(arrayBuilder(), "array binding");
const slots = [renamedBuilder()];
logger.error(slots[0], "array member result");

let selected: typeof renamedBuilder;
selected = renamedBuilder;
logger.error(selected(), "assigned alias");
const conditional = true ? renamedBuilder : buildOrdinaryFields;
logger.error(conditional(), "conditional alias");
logger.error((0, renamedBuilder)(), "sequence call");
const bound = renamedBuilder.bind(null);
logger.error(bound(), "bound alias");

let objectAlias: typeof renamedBuilder;
({ buildFields: objectAlias } = builders);
logger.error(objectAlias(), "object destructuring assignment");
let arrayAlias: typeof renamedBuilder;
[arrayAlias] = [renamedBuilder];
logger.error(arrayAlias(), "array destructuring assignment");
const holder = {} as { fn: typeof renamedBuilder };
holder.fn = renamedBuilder;
logger.error(holder.fn(), "property assignment");
logger.error({ nested: holder["fn"]() }, "property assignment nested");

// Even an alias form not modeled by static provenance cannot silently pass at
// the structured-fields boundary.
const opaqueHolder = {} as { fn: typeof renamedBuilder };
Object.assign(opaqueHolder, { fn: renamedBuilder });
logger.error(opaqueHolder.fn(), "unresolved callee fails closed");

let reassignedFields: object = {};
reassignedFields = renamedBuilder();
logger.error(reassignedFields, "initialized then reassigned result");
const resultHolder = {} as { fields: object };
resultHolder.fields = {};
resultHolder.fields = renamedBuilder();
logger.error(resultHolder.fields, "multiple property writes");
let branchFields: object = {};
if (Date.now() > 0) {
  branchFields = renamedBuilder();
} else {
  branchFields = { status: "ok" };
}
logger.error(branchFields, "all branch sources");
const branchHolder = {} as { fields: object };
if (Date.now() > 0) {
  branchHolder.fields = renamedBuilder();
} else {
  branchHolder.fields = {};
}
logger.error(branchHolder.fields, "all property branch sources");

logger.error((renamedBuilder() as any).fields, "call result member");
logger.error((renamedBuilder() as any)[0], "call result index");
const memberResult = (renamedBuilder() as any).fields;
logger.error(memberResult, "aliased call result member");
function withDefault(defaultFields = renamedBuilder()) {
  logger.error(defaultFields, "parameter default");
}
const { defaultResult = renamedBuilder() } = {} as { defaultResult?: object };
logger.error(defaultResult, "destructuring default");
function withBindingDefault({ bindingDefault = renamedBuilder() }: { bindingDefault?: object }) {
  logger.error(bindingDefault, "parameter destructuring default");
}
logger.error(new (renamedBuilder as any)(), "opaque constructor");
void withDefault;
void withBindingDefault;

class FieldLogger {
  fields = renamedBuilder();
  log() {
    logger.error(this.fields, "class field initializer");
  }
}
class ConstructorLogger {
  constructorFields: object;
  constructor() {
    this.constructorFields = renamedBuilder();
  }
  log() {
    logger.error(this.constructorFields, "constructor assignment");
  }
}
void FieldLogger;
void ConstructorLogger;