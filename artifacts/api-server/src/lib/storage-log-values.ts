import ts from "typescript";

export function collectStorageLogBindings(
  name: ts.BindingName,
  initializer: ts.Expression,
  bindings: Map<string, ts.Expression[]>,
): void {
  if (ts.isIdentifier(name)) {
    const values = bindings.get(name.text) ?? [];
    values.push(initializer);
    bindings.set(name.text, values);
    return;
  }
  name.elements.forEach((element, index) => {
    if (!ts.isBindingElement(element)) return;
    const key = ts.isArrayBindingPattern(name)
      ? ts.factory.createNumericLiteral(index)
      : element.propertyName && ts.isComputedPropertyName(element.propertyName)
        ? element.propertyName.expression
        : ts.factory.createStringLiteral(
          (element.propertyName as ts.Identifier | ts.StringLiteral | undefined)?.text ??
          (ts.isIdentifier(element.name) ? element.name.text : ""),
        );
    collectStorageLogBindings(
      element.name,
      element.dotDotDotToken
        ? initializer
        : ts.factory.createElementAccessExpression(initializer, key),
      bindings,
    );
    if (element.initializer) {
      collectStorageLogBindings(element.name, element.initializer, bindings);
    }
  });
}

function memberName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) {
    const key = expression.argumentExpression;
    if (ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)) return key.text;
  }
  return undefined;
}

export function storageLogReferenceKey(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (expression.kind === ts.SyntaxKind.SuperKeyword) return "super";
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    const owner = storageLogReferenceKey(expression.expression);
    const member = memberName(expression);
    if (owner && member !== undefined) return `${owner}[${JSON.stringify(member)}]`;
  }
  return undefined;
}

export function collectStorageLogAssignments(
  target: ts.Expression,
  value: ts.Expression,
  bindings: Map<string, ts.Expression[]>,
): void {
  if (ts.isParenthesizedExpression(target)) {
    collectStorageLogAssignments(target.expression, value, bindings);
    return;
  }
  const key = storageLogReferenceKey(target);
  if (key) {
    const values = bindings.get(key) ?? [];
    values.push(value);
    bindings.set(key, values);
    return;
  }
  if (ts.isObjectLiteralExpression(target)) {
    for (const property of target.properties) {
      if (ts.isSpreadAssignment(property)) {
        collectStorageLogAssignments(property.expression, value, bindings);
      } else if (
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)
      ) {
        const key = ts.isComputedPropertyName(property.name)
          ? property.name.expression
          : ts.factory.createStringLiteral(property.name.text);
        collectStorageLogAssignments(
          ts.isPropertyAssignment(property) ? property.initializer : property.name,
          ts.factory.createElementAccessExpression(value, key),
          bindings,
        );
      }
    }
  } else if (ts.isArrayLiteralExpression(target)) {
    target.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      collectStorageLogAssignments(
        ts.isSpreadElement(element) ? element.expression : element,
        ts.factory.createElementAccessExpression(value, index),
        bindings,
      );
    });
  } else if (ts.isBinaryExpression(target)) {
    // A default value in a destructuring assignment is also a possible source.
    collectStorageLogAssignments(target.left, value, bindings);
    collectStorageLogAssignments(target.left, target.right, bindings);
  }
}

// Resolve only static value reads. Never execute helpers or load imported code.
export function resolveStorageLogValue(
  expression: ts.Expression,
  bindings: Map<string, ts.Expression[]>,
  seen = new Set<ts.Expression>(),
): ts.Expression {
  if (seen.has(expression)) return expression;
  const nextSeen = new Set([...seen, expression]);
  const resolve = (value: ts.Expression) =>
    resolveStorageLogValue(value, bindings, nextSeen);
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) return resolve(expression.expression);
  if (ts.isIdentifier(expression)) {
    const values = bindings.get(expression.text);
    return values?.length === 1 ? resolve(values[0]) : expression;
  }
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    const reference = storageLogReferenceKey(expression);
    const assigned = reference ? bindings.get(reference) : undefined;
    if (assigned?.length === 1) return resolve(assigned[0]);
    const owner = resolve(expression.expression);
    const key = memberName(expression);
    if (key === undefined) return expression;
    if (ts.isObjectLiteralExpression(owner)) {
      for (const property of [...owner.properties].reverse()) {
        if (ts.isSpreadAssignment(property)) {
          const value = resolve(ts.factory.createElementAccessExpression(
            property.expression,
            ts.factory.createStringLiteral(key),
          ));
          if (!ts.isElementAccessExpression(value)) return value;
          continue;
        }
        const name = property.name && (
          ts.isComputedPropertyName(property.name)
            ? ts.isStringLiteralLike(property.name.expression)
              ? property.name.expression.text
              : undefined
            : property.name.text
        );
        if (name !== key) continue;
        if (ts.isPropertyAssignment(property)) return resolve(property.initializer);
        if (ts.isShorthandPropertyAssignment(property)) return resolve(property.name);
      }
    }
    if (ts.isArrayLiteralExpression(owner) && /^\d+$/.test(key)) {
      const value = owner.elements[Number(key)];
      if (value && ts.isExpression(value)) return resolve(value);
    }
  }
  return expression;
}