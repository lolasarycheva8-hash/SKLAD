export type ImportDriver = {
  id: string;
  name: string | null;
  email: string;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

export function getImportDriverOptions(
  drivers: ImportDriver[],
): Array<ImportDriver & { label: string }> {
  const nameCounts = new Map<string, number>();
  for (const driver of drivers) {
    const name = normalize(driver.name ?? "");
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const options = drivers.map((driver) => {
    const name = driver.name?.trim() ?? "";
    const label =
      name && nameCounts.get(normalize(name)) === 1
        ? name
        : name
          ? `${name} — ${driver.email}`
          : driver.email;
    return { ...driver, label };
  });
  const counts = new Map<string, number>();
  for (const option of options) counts.set(normalize(option.label), (counts.get(normalize(option.label)) ?? 0) + 1);
  return options.map((option) => ({
    ...option,
    label: (counts.get(normalize(option.label)) ?? 0) > 1
      ? `${option.label} (ID: ${option.id})`
      : option.label,
  }));
}

export function resolveImportDriver(
  drivers: ImportDriver[],
  nameValue: string,
  legacyEmailValue = "",
): ImportDriver | null {
  const name = normalize(nameValue);
  const email = normalize(legacyEmailValue);
  // A legacy email column is authoritative, even when a displayed name matches
  // another user; new templates use only the unique dropdown label.
  if (!email) {
    const optionMatches = getImportDriverOptions(drivers).filter(
      (driver) => normalize(driver.label) === name,
    );
    const legacyMatches = drivers.filter((driver) => normalize(driver.name ?? "") === name);
    if (optionMatches.length === 1 && legacyMatches.length === 1 && optionMatches[0].id !== legacyMatches[0].id) {
      throw new Error(`Водитель «${nameValue.trim()}» найден неоднозначно. Выберите точный вариант из выпадающего списка нового шаблона.`);
    }
    if (optionMatches.length === 1) return optionMatches[0];
    if (optionMatches.length > 1) {
      throw new Error(`Водитель «${nameValue.trim()}» найден неоднозначно. Выберите точный вариант из выпадающего списка нового шаблона.`);
    }
  }

  const matches = email
    ? drivers.filter((driver) => normalize(driver.email) === email)
    : drivers.filter(
        (driver) => normalize(driver.name ?? "") === name,
      );
  if ((name || email) && matches.length === 0) {
    throw new Error(
      `Водитель ${email || `«${nameValue.trim()}»`} не найден среди пользователей-водителей`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Водитель «${nameValue.trim()}» найден неоднозначно. Выберите точный вариант из выпадающего списка нового шаблона.`,
    );
  }
  return matches[0] ?? null;
}