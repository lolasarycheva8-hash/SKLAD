interface ManagerContactCellProps {
  name: string;
  contact?: string | null;
}

export function ManagerContactCell({ name, contact }: ManagerContactCellProps) {
  const phone = contact?.match(/\+?\d[\d\s().-]{4,}\d/)?.[0];
  const normalized = phone?.replace(/[^\d+]/g, "");
  const href = normalized && normalized.replace(/\D/g, "").length >= 6
    ? `tel:${normalized}`
    : undefined;

  return (
    <div className="space-y-1">
      {name && <div>{name}</div>}
      {contact && (
        href ? (
          <a
            href={href}
            className="block text-sm text-primary underline underline-offset-2"
            aria-label={`Позвонить менеджеру${name ? ` ${name}` : ""}: ${contact}`}
          >
            {contact}
          </a>
        ) : <div className="text-sm text-muted-foreground">{contact}</div>
      )}
      {!name && !contact && "—"}
    </div>
  );
}