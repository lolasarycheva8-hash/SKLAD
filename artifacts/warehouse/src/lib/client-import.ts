type ClientLookup = {
  id: string;
  name: string;
};

const CLIENT_NAME_WHITESPACE_PATTERN =
  /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+/gu;
const CLIENT_NAME_INVISIBLE_PATTERN = /[\u200B-\u200D\u2060]+/gu;

function normalizeClientNameWhitespace(value: string): string {
  return value
    .replace(CLIENT_NAME_INVISIBLE_PATTERN, "")
    .replace(CLIENT_NAME_WHITESPACE_PATTERN, " ")
    .trim();
}

export function canonicalizeClientName(value: string): string {
  return normalizeClientNameWhitespace(value).toLocaleLowerCase("ru-RU");
}

export function resolveImportClient(
  clients: ClientLookup[],
  importedName: string,
): ClientLookup {
  const normalizedName = canonicalizeClientName(importedName);
  const matches = clients.filter(
    (client) => canonicalizeClientName(client.name) === normalizedName,
  );
  const displayName = normalizeClientNameWhitespace(importedName);

  if (matches.length === 0) {
    throw new Error(`Клиент «${displayName}» не найден в справочнике`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Клиент «${displayName}» сопоставляется неоднозначно`,
    );
  }
  return matches[0];
}