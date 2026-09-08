import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export function SortableHeader<T extends string>({
  field,
  label,
  sortField,
  sortDir,
  onSort,
  className,
  align = "left",
  testId,
}: {
  field: T;
  label: string;
  sortField: T;
  sortDir: SortDirection;
  onSort: (field: T) => void;
  className?: string;
  align?: "left" | "right";
  testId?: string;
}) {
  const isActive = sortField === field;
  const Icon = isActive ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors select-none",
          align === "right" && "flex-row-reverse w-full justify-start",
          isActive ? "text-foreground font-medium" : "text-muted-foreground",
        )}
        data-testid={testId ?? `sort-${field}`}
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}
