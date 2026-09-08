export type ImportDriver = {
  id: string;
  name: string | null;
  email: string;
};

export function resolveImportDriver(
  drivers: ImportDriver[],
  nameValue: string,
  emailValue: string,
): ImportDriver | null {
  const name = nameValue.trim().toLocaleLowerCase("ru");
  const email = emailValue.trim().toLocaleLowerCase("ru");
  const matches = email
    ? drivers.filter((driver) => driver.email.trim().toLocaleLowerCase("ru") === email)
    : drivers.filter(
        (driver) => driver.name?.trim().toLocaleLowerCase("ru") === name,
      );
  if ((name || email) && matches.length === 0) {
    throw new Error(
      `Водитель ${email || `«${nameValue.trim()}»`} не найден среди пользователей-водителей`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Водитель «${nameValue.trim()}» найден неоднозначно. Укажите Email водителя.`,
    );
  }
  return matches[0] ?? null;
}