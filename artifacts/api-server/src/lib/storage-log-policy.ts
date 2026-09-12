import ts from "typescript";
import { createStorageLogImportResolver } from "./storage-log-imports.ts";
import {
  collectStorageLogAssignments,
  collectStorageLogBindings,
  resolveStorageLogValue,
  storageLogReferenceKey,
} from "./storage-log-values.ts";

const LOGGER_METHODS = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

const PRIVATE_STORAGE_FIELD_NAMES = new Set([
  "objectpath",
  "rawpath",
  "uploadurl",
]);

const SAFE_STORAGE_FIELD_BUILDERS = new Set([
  "createStorageFailureLogFields",
  "sanitizeCleanupFailureForLog",
  "sanitizePrivateStorageObjectPath",
  "sanitizePrivateStorageRequestUrl",
  "sanitizePrivateStorageText",
]);

const SAFE_STORAGE_TEXT_SANITIZERS = new Set([
  "sanitizePrivateStorageText",
]);

export type StorageLogPolicyViolation = {
  fileName: string;
  line: number;
  column: number;
  fieldName: string;
  message: string;
};

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (
    ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(name.expression)
  ) {
    return name.expression.text;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isStructuredLoggerCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (!LOGGER_METHODS.has(node.expression.name.text)) return false;

  const owner = node.expression.expression;
  if (ts.isIdentifier(owner)) {
    return owner.text === "logger" || owner.text === "log";
  }
  if (!ts.isPropertyAccessExpression(owner)) return false;
  return owner.name.text === "logger" || owner.name.text === "log";
}

export function findUnsafeStorageLoggerFields(
  sourceText: string,
  fileName = "source.ts",
): StorageLogPolicyViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: StorageLogPolicyViolation[] = [];
  const initializersByName = new Map<string, ts.Expression[]>();
  const helperReturnsByName = new Map<string, ts.Expression[]>();

  function addHelperReturn(name: string, expression: ts.Expression): void {
    const returns = helperReturnsByName.get(name) ?? [];
    returns.push(expression);
    helperReturnsByName.set(name, returns);
  }

  function collectFunctionReturns(
    name: string,
    body: ts.ConciseBody,
  ): void {
    if (!ts.isBlock(body)) {
      addHelperReturn(name, body);
      return;
    }

    function collectReturn(node: ts.Node): void {
      if (node !== body && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) {
        addHelperReturn(name, node.expression);
        return;
      }
      ts.forEachChild(node, collectReturn);
    }
    collectReturn(body);
  }

  function collectInitializers(node: ts.Node): void {
    if (ts.isPropertyDeclaration(node) && node.initializer) {
      const member = ts.isComputedPropertyName(node.name)
        ? node.name.expression
        : ts.factory.createStringLiteral(node.name.text);
      collectStorageLogAssignments(
        ts.factory.createElementAccessExpression(ts.factory.createThis(), member),
        node.initializer,
        initializersByName,
      );
    }
    if (ts.isParameter(node) && (node.initializer || !ts.isIdentifier(node.name))) {
      collectStorageLogBindings(
        node.name,
        node.initializer ?? ts.factory.createIdentifier("__parameter_value__"),
        initializersByName,
      );
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      collectStorageLogBindings(node.name, node.initializer, initializersByName);
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsToken,
        ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      collectStorageLogAssignments(node.left, node.right, initializersByName);
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      collectFunctionReturns(node.name.text, node.body);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (
        ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)
      ) {
        collectFunctionReturns(node.name.text, node.initializer.body);
      }
    }
    ts.forEachChild(node, collectInitializers);
  }
  collectInitializers(sourceFile);
  const importedHelpers = createStorageLogImportResolver(
    sourceFile,
    initializersByName,
  );

  function isSafeStorageCall(
    expression: ts.Expression,
    allowedNames: Set<string>,
  ): boolean {
    const unwrapped = unwrapExpression(expression);
    if (!ts.isCallExpression(unwrapped)) return false;
    const imported = importedHelpers.resolve(unwrapped.expression);
    if (imported) {
      return importedHelpers.isTrusted(imported) &&
        allowedNames.has(imported.exportName);
    }
    // Legacy implicit globals in single-file fixtures may use reviewed names.
    // A real local binding or arbitrary member must instead prove its origin.
    const callee = unwrapExpression(unwrapped.expression);
    return ts.isIdentifier(callee) &&
      !initializersByName.has(callee.text) &&
      !helperReturnsByName.has(callee.text) &&
      allowedNames.has(callee.text);
  }

  function isSafeStorageFieldsExpression(expression: ts.Expression): boolean {
    return isSafeStorageCall(expression, SAFE_STORAGE_FIELD_BUILDERS);
  }

  function report(
    node: ts.Node,
    fieldName: string,
    message = `Поле ${fieldName} передано в logger без Storage-sanitizer`,
  ) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push({
      fileName,
      line: location.line + 1,
      column: location.character + 1,
      fieldName,
      message,
    });
  }

  function inspectStructuredValue(
    expression: ts.Expression,
    inspectedIdentifiers = new Set<string>(),
    inspectedHelpers = new Set<string>(),
    requireKnownBuilder = true,
  ): void {
    const unwrapped = unwrapExpression(expression);
    if (isSafeStorageFieldsExpression(unwrapped)) return;

    if (
      ts.isPropertyAccessExpression(unwrapped) ||
      ts.isElementAccessExpression(unwrapped)
    ) {
      const reference = storageLogReferenceKey(unwrapped);
      const assigned = reference ? initializersByName.get(reference) : undefined;
      if (reference && assigned?.length) {
        if (inspectedIdentifiers.has(reference)) return;
        const nextInspected = new Set([...inspectedIdentifiers, reference]);
        for (const value of assigned) {
          inspectStructuredValue(value, nextInspected, inspectedHelpers, requireKnownBuilder);
        }
        return;
      }
      const value = resolveStorageLogValue(unwrapped, initializersByName);
      if (value !== unwrapped) {
        inspectStructuredValue(value, inspectedIdentifiers, inspectedHelpers, requireKnownBuilder);
        return;
      }
      const receiver = requireKnownBuilder
        ? resolveStorageLogValue(unwrapped.expression, initializersByName)
        : unwrapExpression(unwrapped.expression);
      if (
        ts.isCallExpression(receiver) ||
        ts.isNewExpression(receiver) ||
        ts.isAwaitExpression(receiver) ||
        ts.isPropertyAccessExpression(receiver) ||
        ts.isElementAccessExpression(receiver)
      ) {
        inspectStructuredValue(receiver, inspectedIdentifiers, inspectedHelpers, requireKnownBuilder);
      }
      return;
    }

    if (ts.isCallExpression(unwrapped) || ts.isNewExpression(unwrapped)) {
      const imported = importedHelpers.resolve(unwrapped.expression);
      if (imported) {
        if (ts.isCallExpression(unwrapped) && importedHelpers.isTrustedFieldsBuilder(imported)) return;
        const helperName = unwrapped.expression.getText(sourceFile);
        report(
          unwrapped.expression,
          helperName,
          `Импортированный helper ${helperName} из ${imported.moduleName} ` +
            "передан в logger без проверки Storage-полей; используйте утверждённый Storage-builder",
        );
        return;
      }
    }

    if (ts.isAwaitExpression(unwrapped) || ts.isSpreadElement(unwrapped)) {
      inspectStructuredValue(unwrapped.expression, inspectedIdentifiers, inspectedHelpers, requireKnownBuilder);
      return;
    }
    if (ts.isConditionalExpression(unwrapped)) {
      inspectStructuredValue(unwrapped.whenTrue, inspectedIdentifiers, inspectedHelpers, requireKnownBuilder);
      inspectStructuredValue(unwrapped.whenFalse, inspectedIdentifiers, inspectedHelpers, requireKnownBuilder);
      return;
    }
    if (ts.isBinaryExpression(unwrapped)) {
      inspectStructuredValue(unwrapped.left, inspectedIdentifiers, inspectedHelpers, requireKnownBuilder);
      inspectStructuredValue(unwrapped.right, inspectedIdentifiers, inspectedHelpers, requireKnownBuilder);
      return;
    }

    if (ts.isIdentifier(unwrapped)) {
      if (inspectedIdentifiers.has(unwrapped.text)) return;
      const initializers = initializersByName.get(unwrapped.text);
      if (initializers?.length) {
        const nextInspectedIdentifiers = new Set(inspectedIdentifiers);
        nextInspectedIdentifiers.add(unwrapped.text);
        for (const initializer of initializers) {
          inspectStructuredValue(
            initializer,
            nextInspectedIdentifiers,
            inspectedHelpers,
            requireKnownBuilder,
          );
        }
      }
      return;
    }

    if (
      ts.isCallExpression(unwrapped) &&
      ts.isIdentifier(unwrapped.expression) &&
      !inspectedHelpers.has(unwrapped.expression.text)
    ) {
      const helperName = unwrapped.expression.text;
      const helperReturns = helperReturnsByName.get(helperName);
      if (helperReturns) {
        const nextInspectedHelpers = new Set(inspectedHelpers);
        nextInspectedHelpers.add(helperName);
        for (const returnedExpression of helperReturns) {
          inspectStructuredValue(
            returnedExpression,
            inspectedIdentifiers,
            nextInspectedHelpers,
            requireKnownBuilder,
          );
        }
        return;
      }
    }

    // At the structured-fields boundary, an opaque call is never evidence of
    // safety. This also catches alias forms we cannot statically resolve.
    // Nested scalar computations retain their existing behavior, while known
    // imported calls there are rejected above regardless of this flag.
    if (ts.isCallExpression(unwrapped) || ts.isNewExpression(unwrapped)) {
      if (requireKnownBuilder) {
        const helperName = unwrapped.expression.getText(sourceFile);
        report(
          unwrapped.expression,
          helperName,
          `Непроверенный helper ${helperName} передан в logger; ` +
            "используйте утверждённый Storage-builder или проверяемый локальный helper",
        );
      }
      return;
    }

    if (ts.isObjectLiteralExpression(unwrapped)) {
      for (const property of unwrapped.properties) {
        if (ts.isSpreadAssignment(property)) {
          inspectStructuredValue(
            property.expression,
            inspectedIdentifiers,
            inspectedHelpers,
          );
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          if (
            PRIVATE_STORAGE_FIELD_NAMES.has(
              property.name.text.toLocaleLowerCase("en-US"),
            )
          ) {
            report(property.name, property.name.text);
          } else {
            inspectStructuredValue(
              property.name,
              inspectedIdentifiers,
              inspectedHelpers,
              false,
            );
          }
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;

        const name = propertyName(property.name);
        if (
          name &&
          PRIVATE_STORAGE_FIELD_NAMES.has(name.toLocaleLowerCase("en-US")) &&
          !isSafeStorageFieldsExpression(property.initializer)
        ) {
          report(property.name, name);
        }
        inspectStructuredValue(
          property.initializer,
          inspectedIdentifiers,
          inspectedHelpers,
          false,
        );
      }
      return;
    }

    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isExpression(element)) {
          inspectStructuredValue(
            element,
            inspectedIdentifiers,
            inspectedHelpers,
          );
        }
      }
    }
  }

  function inspectLoggerTextExpression(expression: ts.Expression): void {
    const unwrapped = unwrapExpression(expression);

    if (isSafeStorageCall(unwrapped, SAFE_STORAGE_TEXT_SANITIZERS)) return;

    if (ts.isIdentifier(unwrapped)) {
      const name = unwrapped.text;
      if (PRIVATE_STORAGE_FIELD_NAMES.has(name.toLocaleLowerCase("en-US"))) {
        report(unwrapped, name);
      }
      return;
    }

    if (ts.isPropertyAccessExpression(unwrapped)) {
      const name = unwrapped.name.text;
      if (PRIVATE_STORAGE_FIELD_NAMES.has(name.toLocaleLowerCase("en-US"))) {
        report(unwrapped.name, name);
        return;
      }
    }

    if (
      ts.isObjectLiteralExpression(unwrapped) ||
      ts.isArrayLiteralExpression(unwrapped)
    ) {
      return;
    }

    if (ts.isTemplateExpression(unwrapped)) {
      for (const span of unwrapped.templateSpans) {
        inspectLoggerTextExpression(span.expression);
      }
      return;
    }

    ts.forEachChild(unwrapped, (child) => {
      if (ts.isExpression(child)) {
        inspectLoggerTextExpression(child);
      }
    });
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      isStructuredLoggerCall(node) &&
      node.arguments[0]
    ) {
      inspectStructuredValue(node.arguments[0]);
      for (const argument of node.arguments) {
        inspectLoggerTextExpression(argument);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}