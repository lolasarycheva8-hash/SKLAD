import path from "node:path";
import ts from "typescript";
import { resolveStorageLogValue, storageLogReferenceKey } from "./storage-log-values.ts";

type ImportedBinding = {
  moduleName: string;
  exportName: string;
};

const TRUSTED_STORAGE_MODULE = path.resolve(
  import.meta.dirname,
  "storage-log-sanitizer",
);
const TRUSTED_STORAGE_EXPORTS = new Set([
  "createStorageFailureLogFields",
  "sanitizePrivateStorageObjectPath",
  "sanitizePrivateStorageRequestUrl",
  "sanitizePrivateStorageText",
]);

export function createStorageLogImportResolver(
  sourceFile: ts.SourceFile,
  initializersByName: Map<string, ts.Expression[]>,
) {
  const imports = new Map<string, ImportedBinding>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly
    ) continue;

    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause.name) {
      imports.set(clause.name.text, { moduleName, exportName: "default" });
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, { moduleName, exportName: "*" });
    } else if (clause.namedBindings) {
      for (const specifier of clause.namedBindings.elements) {
        if (specifier.isTypeOnly) continue;
        imports.set(specifier.name.text, {
          moduleName,
          exportName: (specifier.propertyName ?? specifier.name).text,
        });
      }
    }
  }

  function resolve(
    expression: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): ImportedBinding | undefined {
    if (seen.has(expression)) return undefined;
    const nextSeen = new Set([...seen, expression]);
    const value = resolveStorageLogValue(expression, initializersByName);
    if (value !== expression) return resolve(value, nextSeen);
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) return resolve(expression.expression, nextSeen);

    if (ts.isIdentifier(expression)) {
      const imported = imports.get(expression.text);
      if (imported) return imported;
      // Multiple initializers/assignments cannot be resolved to one value,
      // but any imported source is enough to withhold trust.
      for (const initializer of initializersByName.get(expression.text) ?? []) {
        const origin = resolve(initializer, nextSeen);
        if (origin) return { ...origin, exportName: "<unknown>" };
      }
      return undefined;
    }
    if (
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
    ) {
      const reference = storageLogReferenceKey(expression);
      for (const assigned of (reference && initializersByName.get(reference)) || []) {
        const origin = resolve(assigned, nextSeen);
        if (origin) return { ...origin, exportName: "<unknown>" };
      }
      const owner = resolve(expression.expression, nextSeen);
      if (!owner) return undefined;
      const member = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : ts.isStringLiteralLike(expression.argumentExpression)
          ? expression.argumentExpression.text
          : undefined;
      return {
        moduleName: owner.moduleName,
        // Only a direct, statically named namespace export can be trusted.
        exportName: owner.exportName === "*" && member ? member : "<unknown>",
      };
    }
    // Track expressions that select or bind callable values. Do not treat
    // ordinary data returned by a function as a callable alias (e.g. a parsed
    // email's trim() or an array's map() is not an imported builder).
    const candidates: ts.Expression[] = [];
    if (ts.isConditionalExpression(expression)) {
      candidates.push(expression.whenTrue, expression.whenFalse);
    } else if (ts.isBinaryExpression(expression)) {
      candidates.push(expression.left, expression.right);
    } else if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      ["bind", "call", "apply"].includes(expression.expression.name.text)
    ) {
      candidates.push(expression.expression.expression);
    }
    for (const candidate of candidates) {
      const origin = resolve(candidate, nextSeen);
      if (origin) return { ...origin, exportName: "<unknown>" };
    }
    return undefined;
  }

  function isTrusted(binding: ImportedBinding): boolean {
    return importedModulePath(binding) === TRUSTED_STORAGE_MODULE &&
      TRUSTED_STORAGE_EXPORTS.has(binding.exportName);
  }

  function importedModulePath(binding: ImportedBinding): string | undefined {
    if (!binding.moduleName.startsWith(".")) return undefined;
    return path.resolve(
      path.dirname(sourceFile.fileName),
      binding.moduleName.replace(/\.(?:ts|js)$/, ""),
    );
  }

  function isTrustedFieldsBuilder(binding: ImportedBinding): boolean {
    // This reviewed builder returns only a phase and numeric metrics. It is
    // safe as structured fields, but is NOT a sanitizer for private values.
    return isTrusted(binding) || (
      importedModulePath(binding) === path.resolve(
        import.meta.dirname,
        "bulk-site-import-slow-store",
      ) &&
      binding.exportName === "recordBulkSiteImportSlowWarning"
    );
  }

  return { resolve, isTrusted, isTrustedFieldsBuilder };
}