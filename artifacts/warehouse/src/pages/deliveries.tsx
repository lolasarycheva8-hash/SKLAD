import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  useListDeliveries,
  useCreateDeliveriesBulk,
  useReplaceDeliveriesBulk,
  useUpdateDelivery,
  useDeleteDelivery,
  useListDeliverySiteLookup,
  useListDrivers,
  useRescheduleDelivery,
  useApproveDeliveryAct,
  getListDeliveriesQueryKey,
  getGetDeliveryDashboardSummaryQueryKey,
  type Delivery,
} from "@workspace/api-client-react";
import {
  parseExcelFile,
  readSheetHeaders,
  validateTemplateHeaders,
  downloadTemplate,
  exportRowsToExcel,
  str,
  excelSerialToIsoDate,
} from "@/lib/excel-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DeliveryPhotosDialog } from "@/components/delivery-photos-dialog";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import {
  canRescheduleDelivery,
  confirmPlannedDate,
  getDeliveryCellTone,
  getInitialRescheduleDate,
  getMonthDateBounds,
  getScheduleCellState,
  parseImportPlannedDate,
  toDateInputValue,
} from "@/lib/delivery-workspace";
import { resolveImportDriver } from "@/lib/driver-import";
import {
  CalendarClock,
  Check,
  AlertTriangle,
  Download,
  FileDown,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function currentMonthValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

function formatMonthLabel(value: string) {
  const [year, monthNumber] = value.split("-").map(Number);
  if (!year || !monthNumber) return value;
  const monthName = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  return `${monthName} ${String(year).slice(-2)}`;
}

const TEMPLATE_HEADERS = ["Объект", "Водитель", "Email водителя", "Плановая дата"];

const CELL_ORANGE =
  "bg-amber-100/60 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200";
const CELL_GREEN =
  "bg-emerald-100/60 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200";
const CELL_BLUE =
  "bg-blue-100/60 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200";
const TABLE_PAGE_SIZE = 100;

type JoinedDelivery = Delivery & {
  siteAddress: string;
  siteBranch: string;
  siteManager: string;
  siteDeliveryType: string;
  siteClient: string;
};

type ScheduleRow = {
  siteId: string;
  siteName: string;
  driverUserId: string;
  plannedDate: string;
};

function TablePager({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE));
  if (total <= TABLE_PAGE_SIZE) return null;
  const start = (page - 1) * TABLE_PAGE_SIZE + 1;
  const end = Math.min(page * TABLE_PAGE_SIZE, total);

  return (
    <div className="flex items-center justify-end gap-2 pt-2 shrink-0">
      <span className="text-xs text-muted-foreground">
        {start}–{end} из {total}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Назад
      </Button>
      <span className="text-xs">
        {page} / {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Далее
      </Button>
    </div>
  );
}

function FactDateCell({
  delivery,
  month,
  onChange,
  disabled,
}: {
  delivery: JoinedDelivery;
  month: string;
  onChange: (val: string) => void;
  disabled: boolean;
}) {
  const { min: minDate, max: maxDate } = getMonthDateBounds(month);

  if (delivery.actualDate) {
    return (
      <input
        type="date"
        min={minDate}
        max={maxDate}
        disabled={disabled}
        value={toDateInputValue(delivery.actualDate)}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-[130px] px-2 text-sm border rounded bg-background shadow-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        data-testid={`input-actual-date-${delivery.id}`}
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        min={minDate}
        max={maxDate}
        disabled={disabled}
        value={delivery.plannedDate ? toDateInputValue(delivery.plannedDate) : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-[130px] px-2 text-sm text-muted-foreground border border-dashed rounded bg-background outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        title="Выберите фактическую дату"
        data-testid={`input-actual-date-${delivery.id}`}
      />
      {!disabled && delivery.plannedDate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          onClick={() => onChange(confirmPlannedDate(delivery.plannedDate as string))}
          title="Подтвердить доставку по плановой дате"
          aria-label="Подтвердить доставку по плановой дате"
          data-testid={`button-confirm-planned-date-${delivery.id}`}
        >
          <Check className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: string[];
  testId?: string;
}) {
  return (
    <Select
      value={value || "all"}
      onValueChange={(v) => onChange(v === "all" ? "" : v)}
    >
      <SelectTrigger
        className={cn(
          "h-8 text-xs w-[160px] bg-background",
          value && "border-primary"
        )}
        data-testid={testId}
      >
        <div className="truncate">
          {value ? (
            <span className="font-medium text-primary">
              {label}: {value}
            </span>
          ) : (
            <span className="text-muted-foreground">{label}...</span>
          )}
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortHeader({
  label,
  field,
  sortConfig,
  onSort,
}: {
  label: string;
  field: string;
  sortConfig: { field: string; dir: "asc" | "desc" };
  onSort: (f: string) => void;
}) {
  return (
    <th
      className="p-2 cursor-pointer hover:bg-muted/50 transition-colors font-medium whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortConfig.field === field && (
          <span className="text-[10px] text-primary">
            {sortConfig.dir === "asc" ? "▲" : "▼"}
          </span>
        )}
      </div>
    </th>
  );
}

export default function Deliveries() {
  const [, setLocation] = useLocation();
  const initialParams = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const [activeTab, setActiveTab] = useState<"workspace" | "schedule">(
    initialParams.get("view") === "undated" ? "schedule" : "workspace"
  );
  const [month, setMonth] = useState(() => {
    const requestedMonth = initialParams.get("month");
    return requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
      ? requestedMonth
      : currentMonthValue();
  });
  const [search, setSearch] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState<
    | "no-deliveries"
    | "completed"
    | "incomplete"
    | "overdue-up-to-3"
    | "overdue-over-3"
    | null
  >(null);
  const [workspacePage, setWorkspacePage] = useState(1);
  const [schedulePage, setSchedulePage] = useState(1);

  const [filters, setFilters] = useState({
    siteName: "",
    address: "",
    branch: "",
    manager: "",
    deliveryType: "",
    driver: "",
    client: "",
    plannedDate: "",
    actualDate: "",
    lagDays: "",
  });

  const [sortConfig, setSortConfig] = useState<{
    field: string;
    dir: "asc" | "desc";
  }>({ field: "siteName", dir: "asc" });

  const [generateOpen, setGenerateOpen] = useState(false);
  const [importMode, setImportMode] = useState<"replace" | "add">("replace");
  const [pendingReplacement, setPendingReplacement] = useState<
    { siteId: string; driverUserId: string | null; plannedDate: string | null; scheduleMonth: string }[] | null
  >(null);
  const [scheduleRows, setScheduleRows] = useState<{
    siteId: string;
    siteName: string;
    driverUserId: string | null;
    plannedDate: string | null;
  }[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Delivery | null>(null);
  const [photosDelivery, setPhotosDelivery] = useState<Delivery | null>(null);
  const [rescheduleDeliveryTarget, setRescheduleDeliveryTarget] =
    useState<Delivery | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>("");
  const [driverChangeTarget, setDriverChangeTarget] = useState<Delivery | null>(
    null
  );
  const [replacementDriver, setReplacementDriver] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const undatedSectionRef = useRef<HTMLDivElement>(null);
  const { canEdit, isAdmin, canApproveDeliveryActs } = usePermissions();
  const canEditDeliveries = canEdit("deliveries");

  const { data: deliveries } = useListDeliveries({ month });
  const { data: sites } = useListDeliverySiteLookup();
  const { data: drivers = [] } = useListDrivers();

  const joinedData = useMemo<JoinedDelivery[]>(() => {
    if (!deliveries || !sites) return [];
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    return deliveries.map((d) => {
      const s = siteMap.get(d.siteId);
      return {
        ...d,
        siteAddress: s?.address || "",
        siteBranch: s?.branch || "",
        siteManager: s?.manager || "",
        siteDeliveryType: s?.deliveryType || "",
        siteClient: s?.client || "",
      };
    });
  }, [deliveries, sites]);

  const filteredData = useMemo(() => {
    return joinedData.filter((d) => {
      if (workspaceStatus === "no-deliveries") return false;
      if (workspaceStatus === "completed" && !d.actualDate) return false;
      if (workspaceStatus === "incomplete" && d.actualDate) return false;
      if (
        workspaceStatus === "overdue-up-to-3" &&
        !(d.lagDays !== null && d.lagDays > 0 && d.lagDays <= 3)
      )
        return false;
      if (
        workspaceStatus === "overdue-over-3" &&
        !(d.lagDays !== null && d.lagDays > 3)
      )
        return false;
      const searchValue = search.trim().toLocaleLowerCase("ru");
      if (
        searchValue &&
        ![
          d.siteName,
          d.siteAddress,
          d.siteBranch,
          d.siteManager,
          d.siteDeliveryType,
          d.driver,
          d.siteClient,
          d.plannedDate,
          d.actualDate,
          d.lagDays,
        ].some((value) =>
          String(value ?? "").toLocaleLowerCase("ru").includes(searchValue),
        )
      )
        return false;
      if (filters.siteName && d.siteName !== filters.siteName) return false;
      if (filters.address && d.siteAddress !== filters.address) return false;
      if (filters.branch && d.siteBranch !== filters.branch) return false;
      if (filters.manager && d.siteManager !== filters.manager) return false;
      if (filters.deliveryType && d.siteDeliveryType !== filters.deliveryType)
        return false;
      if (filters.driver && d.driver !== filters.driver) return false;
      if (filters.client && d.siteClient !== filters.client) return false;
      if (filters.plannedDate && d.plannedDate !== filters.plannedDate) return false;
      if (filters.actualDate && d.actualDate !== filters.actualDate) return false;
      if (filters.lagDays && String(d.lagDays) !== filters.lagDays) return false;
      return true;
    });
  }, [joinedData, filters, search, workspaceStatus]);

  const sitesWithoutDeliveries = useMemo(() => {
    if (workspaceStatus !== "no-deliveries") return [];
    const deliverySiteIds = new Set(joinedData.map((delivery) => delivery.siteId));
    const searchValue = search.trim().toLocaleLowerCase("ru");

    return (sites ?? [])
      .filter((site) => {
        if (site.isClosed || deliverySiteIds.has(site.id)) return false;
        if (
          searchValue &&
          ![
            site.name,
            site.address,
            site.branch,
            site.manager,
            site.deliveryType,
            site.driver,
            site.client,
          ].some((value) =>
            String(value ?? "").toLocaleLowerCase("ru").includes(searchValue),
          )
        )
          return false;
        if (filters.siteName && site.name !== filters.siteName) return false;
        if (filters.address && site.address !== filters.address) return false;
        if (filters.branch && site.branch !== filters.branch) return false;
        if (filters.manager && site.manager !== filters.manager) return false;
        if (
          filters.deliveryType &&
          site.deliveryType !== filters.deliveryType
        )
          return false;
        if (filters.driver && site.driver !== filters.driver) return false;
        if (filters.client && site.client !== filters.client) return false;
        if (filters.plannedDate || filters.actualDate || filters.lagDays)
          return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [filters, joinedData, search, sites, workspaceStatus]);

  const overdueCounts = useMemo(
    () => ({
      upTo3: joinedData.filter(
        (delivery) =>
          delivery.lagDays !== null &&
          delivery.lagDays > 0 &&
          delivery.lagDays <= 3,
      ).length,
      over3: joinedData.filter(
        (delivery) => delivery.lagDays !== null && delivery.lagDays > 3,
      ).length,
    }),
    [joinedData],
  );

  const sortedData = useMemo(() => {
    const arr = [...filteredData];
    const { field, dir } = sortConfig;
    const mult = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const valA = (a as any)[field] || "";
      const valB = (b as any)[field] || "";
      if (typeof valA === "number" && typeof valB === "number")
        return (valA - valB) * mult;
      return String(valA).localeCompare(String(valB)) * mult;
    });
    return arr;
  }, [filteredData, sortConfig]);

  const filterOptions = useMemo(() => {
    return {
      siteName: Array.from(
        new Set(joinedData.map((d) => d.siteName).filter(Boolean))
      ).sort(),
      address: Array.from(
        new Set(joinedData.map((d) => d.siteAddress).filter(Boolean))
      ).sort(),
      branch: Array.from(
        new Set(joinedData.map((d) => d.siteBranch).filter(Boolean))
      ).sort(),
      manager: Array.from(
        new Set(joinedData.map((d) => d.siteManager).filter(Boolean))
      ).sort(),
      deliveryType: Array.from(
        new Set(joinedData.map((d) => d.siteDeliveryType).filter(Boolean))
      ).sort(),
      driver: Array.from(
        new Set(joinedData.map((d) => d.driver).filter(Boolean))
      ).sort(),
      client: Array.from(
        new Set(joinedData.map((d) => d.siteClient).filter(Boolean))
      ).sort(),
      plannedDate: Array.from(
        new Set(joinedData.map((d) => d.plannedDate).filter((v): v is string => Boolean(v)))
      ).sort(),
      actualDate: Array.from(
        new Set(joinedData.map((d) => d.actualDate).filter(Boolean) as string[])
      ).sort(),
      lagDays: Array.from(
        new Set(
          joinedData
            .map((d) => d.lagDays)
            .filter((value): value is number => value !== null)
            .map(String)
        )
      ).sort((a, b) => Number(a) - Number(b)),
    };
  }, [joinedData]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetDeliveryDashboardSummaryQueryKey(),
    });
  };

  const createBulk = useCreateDeliveriesBulk({
    mutation: {
      onSuccess: (created) => {
        invalidate();
        setGenerateOpen(false);
        toast({
          title:
            created.length > 0
              ? `Добавлено доставок: ${created.length}`
              : "Новых доставок нет — совпадения пропущены",
        });
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const replaceBulk = useReplaceDeliveriesBulk({
    mutation: {
      onSuccess: () => {
        invalidate();
        setPendingReplacement(null);
        toast({ title: "График месяца полностью заменён" });
      },
      onError: (error) => {
        toast({
          title: "Не удалось заменить график",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const updateDelivery = useUpdateDelivery({
    mutation: {
      onSuccess: () => {
        invalidate();
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const rescheduleDelivery = useRescheduleDelivery({
    mutation: {
      onSuccess: () => {
        invalidate();
        closeRescheduleDialog();
        toast({ title: "Доставка перенесена" });
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const deleteDelivery = useDeleteDelivery({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteTarget(null);
        toast({ title: "Запись удалена" });
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const approveAct = useApproveDeliveryAct({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Акты подтверждены, доставка закрыта" });
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const headers = await readSheetHeaders(file);
      const missing = validateTemplateHeaders(headers, TEMPLATE_HEADERS);
      if (missing.length > 0) {
        toast({
          title: "Файл не соответствует шаблону",
          description: `Отсутствуют колонки: ${missing.join(", ")}`,
          variant: "destructive",
        });
        return;
      }

      const rows = await parseExcelFile(file);
      const siteByName = new Map(
        (sites ?? []).map((site) => [site.name.trim().toLowerCase(), site])
      );

      const items: { siteId: string; driverUserId: string | null; plannedDate: string | null; scheduleMonth: string }[] =
        [];
      const missingSites: string[] = [];
      const invalidDateRows: number[] = [];

      for (const [index, row] of rows.entries()) {
        const siteName = str(row["Объект"]);
        const site = siteByName.get(siteName.toLowerCase());
        if (!site) {
          if (siteName) missingSites.push(siteName);
          continue;
        }

        const dateResult = parseImportPlannedDate(row["Плановая дата"], month);
        if (!dateResult.valid) {
          invalidDateRows.push(index + 2);
          continue;
        }
        const plannedDate = dateResult.date;

        const matchedDriver = resolveImportDriver(
          drivers,
          str(row["Водитель"]),
          str(row["Email водителя"]),
        );
        const driverUserId = matchedDriver?.id ?? site.driverUserId;
        if (!driverUserId) {
          throw new Error(
            `Для объекта «${site.name}» не указан водитель из справочника пользователей-водителей`,
          );
        }
        items.push({
          siteId: site.id,
          driverUserId,
          plannedDate,
          scheduleMonth: month,
        });
      }

      if (items.length === 0) {
        toast({
          title:
            invalidDateRows.length > 0
              ? "В файле нет строк с корректной датой"
              : "Файл пуст или объекты не найдены",
          description:
            invalidDateRows.length > 0
              ? `Проверьте колонку «Плановая дата» в строках: ${invalidDateRows.slice(0, 20).join(", ")}${invalidDateRows.length > 20 ? ` и ещё ${invalidDateRows.length - 20}` : ""}`
              : undefined,
          variant: "destructive",
        });
        return;
      }

      if (missingSites.length > 0) {
        toast({
          title: "Сначала добавьте новые объекты",
          description: `Не найдены: ${missingSites.slice(0, 15).join(", ")}${missingSites.length > 15 ? ` и ещё ${missingSites.length - 15}` : ""}. Добавьте их вручную и повторите загрузку.`,
          variant: "destructive",
        });
        return;
      }
      if (invalidDateRows.length > 0) {
        toast({
          title: `Пропущены строки с некорректной датой: ${invalidDateRows.length}`,
          description: `Строки: ${invalidDateRows.slice(0, 20).join(", ")}${invalidDateRows.length > 20 ? ` и ещё ${invalidDateRows.length - 20}` : ""}. Остальные строки будут загружены.`,
        });
      }

      if (importMode === "replace") {
        setPendingReplacement(items);
      } else {
        createBulk.mutate({ data: { items } });
      }
    } catch (error) {
      toast({
        title: "Не удалось прочитать файл",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }

  function handleExport() {
    const rows = sortedData.map((d) => ({
      Объект: d.siteName,
      Адрес: d.siteAddress,
      Куст: d.siteBranch,
      Менеджер: d.siteManager,
      Водитель: d.driver,
      "Email водителя": drivers.find((driver) => driver.id === d.driverUserId)?.email ?? "",
      "Плановая дата": d.plannedDate ? d.plannedDate.slice(0, 10) : "",
      "Фактическая дата": d.actualDate ? d.actualDate.slice(0, 10) : "",
      Отклонение: d.lagDays !== null ? d.lagDays : "",
    }));
    exportRowsToExcel(
      rows,
      [
        "Объект",
        "Адрес",
        "Куст",
        "Менеджер",
        "Водитель",
        "Email водителя",
        "Плановая дата",
        "Фактическая дата",
        "Отклонение",
      ],
      "рабочее-место-логиста.xlsx"
    );
  }

  function openGenerateDialog() {
    const site = sites?.find((item) => !item.isClosed);
    if (!site) return;
    setScheduleRows([
      {
        siteId: site.id,
        siteName: site.name,
        driverUserId: site.driverUserId ?? "",
        plannedDate: null,
      },
    ]);
    setGenerateOpen(true);
  }

  function updateScheduleRow(siteId: string, patch: Partial<typeof scheduleRows[0]>) {
    setScheduleRows((rows) =>
      rows.map((row) => (row.siteId === siteId ? { ...row, ...patch } : row))
    );
  }

  function handleGenerateSubmit(e: React.FormEvent) {
    e.preventDefault();
    createBulk.mutate({
      data: {
        items: scheduleRows.map((row) => ({
          siteId: row.siteId,
          driverUserId: row.driverUserId || null,
          plannedDate: row.plannedDate || null,
          scheduleMonth: month,
        })),
      },
    });
  }

  function handleActualDateChange(delivery: Delivery, value: string) {
    updateDelivery.mutate({
      id: delivery.id,
      data: { actualDate: value || null },
    });
  }

  function handleDriverChange(delivery: Delivery, driverUserId: string | null) {
    updateDelivery.mutate({
      id: delivery.id,
      data: { driverUserId },
    });
  }

  function openDriverChangeDialog(delivery: Delivery) {
    setDriverChangeTarget(delivery);
    setReplacementDriver(delivery.driverUserId ?? "");
  }

  function handleDriverChangeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!driverChangeTarget) return;
    handleDriverChange(driverChangeTarget, replacementDriver || null);
    setDriverChangeTarget(null);
    setReplacementDriver("");
  }

  function handleRescheduleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rescheduleDeliveryTarget || !rescheduleDate) return;
    if (!rescheduleDeliveryTarget.plannedDate) {
      updateDelivery.mutate({
        id: rescheduleDeliveryTarget.id,
        data: { plannedDate: rescheduleDate },
      }, {
        onSuccess: () => {
          invalidate();
          closeRescheduleDialog();
          toast({ title: "Дата назначена" });
        }
      });
    } else {
      rescheduleDelivery.mutate({
        id: rescheduleDeliveryTarget.id,
        data: { newDate: rescheduleDate },
      });
    }
  }

  function openRescheduleDialog(delivery: Delivery) {
    if (!canRescheduleDelivery(delivery.actualDate)) return;
    setRescheduleDate(delivery.plannedDate ? getInitialRescheduleDate(delivery.plannedDate) : "");
    setRescheduleDeliveryTarget(delivery);
  }

  function closeRescheduleDialog() {
    setRescheduleDeliveryTarget(null);
    setRescheduleDate("");
  }

  function handleSort(field: string) {
    setSortConfig((prev) => ({
      field,
      dir: prev.field === field && prev.dir === "asc" ? "desc" : "asc",
    }));
  }

  // Schedule Matrix logic
  const daysInMonth = new Date(
    parseInt(month.slice(0, 4)),
    parseInt(month.slice(5, 7)),
    0
  ).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const matrixRows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        siteId: string;
        siteName: string;
        driver: string;
        client: string;
        deliveries: JoinedDelivery[];
      }
    >();
    for (const d of filteredData) {
      if (!d.plannedDate) continue;
      const key = `${d.siteId}-${d.driver}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          siteId: d.siteId,
          siteName: d.siteName,
          driver: d.driver,
          client: d.siteClient,
          deliveries: [],
        });
      }
      map.get(key)!.deliveries.push(d);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.siteName.localeCompare(b.siteName)
    );
  }, [filteredData]);

  const undatedDeliveries = useMemo(() => {
    return filteredData.filter((d) => !d.plannedDate);
  }, [filteredData]);
  const undatedCount = useMemo(
    () => joinedData.filter((d) => !d.plannedDate).length,
    [joinedData],
  );

  function showUndatedDeliveries() {
    setActiveTab("schedule");
    window.setTimeout(() => {
      undatedSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  useEffect(() => {
    if (
      initialParams.get("view") === "undated" &&
      deliveries &&
      undatedCount > 0
    ) {
      showUndatedDeliveries();
    }
  }, [deliveries, initialParams, undatedCount]);

  const workspaceTotal = sortedData.length + sitesWithoutDeliveries.length;
  const workspaceStart = (workspacePage - 1) * TABLE_PAGE_SIZE;
  const visibleSortedData = sortedData.slice(
    workspaceStart,
    workspaceStart + TABLE_PAGE_SIZE,
  );
  const visibleSitesStart = Math.max(0, workspaceStart - sortedData.length);
  const visibleSitesLimit = TABLE_PAGE_SIZE - visibleSortedData.length;
  const visibleSitesWithoutDeliveries = sitesWithoutDeliveries.slice(
    visibleSitesStart,
    visibleSitesStart + visibleSitesLimit,
  );
  const scheduleStart = (schedulePage - 1) * TABLE_PAGE_SIZE;
  const visibleMatrixRows = matrixRows.slice(
    scheduleStart,
    scheduleStart + TABLE_PAGE_SIZE,
  );

  useEffect(() => {
    setWorkspacePage(1);
    setSchedulePage(1);
  }, [
    month,
    search,
    workspaceStatus,
    filters.siteName,
    filters.address,
    filters.branch,
    filters.manager,
    filters.deliveryType,
    filters.driver,
    filters.client,
    filters.plannedDate,
    filters.actualDate,
  ]);

  const dayTotals = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const dayStr = `${month}-${String(i + 1).padStart(2, "0")}`;
      let plan = 0,
        done = 0,
        closed = 0,
        failed = 0;
      filteredData.forEach((d) => {
        if (toDateInputValue(d.plannedDate) === dayStr) {
          plan++;
          if (!d.actualDate) failed++;
        }
        if (d.actualDate && toDateInputValue(d.actualDate) === dayStr) {
          if (d.photosCount === 0) done++;
          else closed++;
        }
      });
      return { plan, done, closed, failed };
    });
  }, [filteredData, month, daysInMonth]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <h1
          className="text-2xl font-bold text-foreground"
          data-testid="text-page-title"
        >
          Доставки
        </h1>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {undatedCount > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={showUndatedDeliveries}
              className="border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
              data-testid="button-undated-deliveries"
            >
              <CalendarClock className="h-4 w-4 mr-2" />
              Дата не назначена
              <Badge className="ml-2 bg-amber-600 text-white hover:bg-amber-600">
                {undatedCount}
              </Badge>
            </Button>
          )}
          <label className="relative flex h-9 min-w-[150px] cursor-pointer items-center rounded-md border bg-card px-3 text-sm font-medium shadow-sm focus-within:ring-1 focus-within:ring-primary">
            <span>{formatMonthLabel(month)}</span>
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Выбрать месяц"
              data-testid="input-month-selector"
            />
          </label>

          {canEditDeliveries && (
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImportFile}
              data-testid="input-import-deliveries"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() =>
              downloadTemplate(
                TEMPLATE_HEADERS,
                "шаблон-график-доставок.xlsx",
                [{
                  name: "Справочник водителей",
                  headers: ["Водитель", "Email"],
                  rows: drivers.map((driver) => ({
                    Водитель: driver.name || driver.email,
                    Email: driver.email,
                  })),
                }],
              )
            }
            data-testid="button-download-template"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Шаблон
          </Button>
          {canEditDeliveries && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => {
                setImportMode("replace");
                fileInputRef.current?.click();
              }}
              disabled={
                replaceBulk.isPending ||
                deliveries?.some((delivery) => delivery.actualDate) === true
              }
              title={
                deliveries?.some((delivery) => delivery.actualDate)
                  ? "Полная замена запрещена: в этом месяце уже есть фактические даты"
                  : undefined
              }
              data-testid="button-import-deliveries"
            >
              <Upload className="h-4 w-4 mr-2" />
              Загрузить заново
            </Button>
          )}
          {canEditDeliveries && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => {
                setImportMode("add");
                fileInputRef.current?.click();
              }}
              disabled={createBulk.isPending}
              data-testid="button-add-deliveries-from-file"
            >
              <Upload className="h-4 w-4 mr-2" />
              Добавить из файла
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={handleExport}
            data-testid="button-export-deliveries"
          >
            <Download className="h-4 w-4 mr-2" />
            Выгрузить
          </Button>
          {canEditDeliveries && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setLocation("/deliveries/run")}
              data-testid="button-delivery-run"
            >
              Развоз за день
            </Button>
          )}
          {canEditDeliveries && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setLocation("/sites?add=1")}
              data-testid="button-add-site-from-deliveries"
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить объект
            </Button>
          )}
          {canEditDeliveries && (
            <Button
              size="sm"
              className="h-9"
              onClick={openGenerateDialog}
              data-testid="button-add-delivery"
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить доставку
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b shrink-0">
        <button
          className={cn(
            "px-4 py-2 border-b-2 font-medium transition-colors outline-none",
            activeTab === "workspace"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
          onClick={() => setActiveTab("workspace")}
          data-testid="tab-workspace"
        >
          Рабочее место логиста
        </button>
        <button
          className={cn(
            "px-4 py-2 border-b-2 font-medium transition-colors outline-none",
            activeTab === "schedule"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
          onClick={() => setActiveTab("schedule")}
          data-testid="tab-schedule"
        >
          График доставок
        </button>
      </div>

      {/* Workspace Tab */}
      {activeTab === "workspace" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex flex-wrap items-center gap-2 mb-3 bg-muted/30 p-2 rounded-md border shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8 border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200",
                workspaceStatus === "no-deliveries" &&
                  "bg-amber-500 text-white hover:bg-amber-600",
              )}
              onClick={() =>
                setWorkspaceStatus((status) =>
                  status === "no-deliveries" ? null : "no-deliveries",
                )
              }
              data-testid="button-filter-no-deliveries"
            >
              Нет доставок
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8 border-emerald-400 bg-emerald-100 text-emerald-900 hover:bg-emerald-200",
                workspaceStatus === "completed" &&
                  "bg-emerald-600 text-white hover:bg-emerald-700",
              )}
              onClick={() =>
                setWorkspaceStatus((status) =>
                  status === "completed" ? null : "completed",
                )
              }
              data-testid="button-filter-completed"
            >
              Выполнено
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8 border-rose-400 bg-rose-100 text-rose-900 hover:bg-rose-200",
                workspaceStatus === "incomplete" &&
                  "bg-rose-600 text-white hover:bg-rose-700",
              )}
              onClick={() =>
                setWorkspaceStatus((status) =>
                  status === "incomplete" ? null : "incomplete",
                )
              }
              data-testid="button-filter-incomplete"
            >
              Не выполнено
            </Button>
            <div className="flex items-center gap-2 border-l-2 border-red-300 pl-3">
              <span className="text-[11px] font-bold uppercase tracking-wide text-red-700">
                Проблемы
              </span>
              <Button
                type="button"
                size="sm"
                className={cn(
                  "h-8 border border-orange-700 bg-orange-600 font-bold text-white shadow-md hover:bg-orange-700",
                  workspaceStatus === "overdue-up-to-3" &&
                    "ring-2 ring-orange-800 ring-offset-2",
                )}
                onClick={() =>
                  setWorkspaceStatus((status) =>
                    status === "overdue-up-to-3" ? null : "overdue-up-to-3",
                  )
                }
                data-testid="button-filter-overdue-up-to-3"
              >
                <AlertTriangle className="mr-1.5 h-4 w-4" />
                Просрочено до 3 дней: {overdueCounts.upTo3}
              </Button>
              <Button
                type="button"
                size="sm"
                className={cn(
                  "h-8 border border-red-900 bg-red-700 font-bold text-white shadow-md hover:bg-red-800",
                  workspaceStatus === "overdue-over-3" &&
                    "ring-2 ring-red-950 ring-offset-2",
                )}
                onClick={() =>
                  setWorkspaceStatus((status) =>
                    status === "overdue-over-3" ? null : "overdue-over-3",
                  )
                }
                data-testid="button-filter-overdue-over-3"
              >
                <AlertTriangle className="mr-1.5 h-4 w-4" />
                Просрочено более 3 дней: {overdueCounts.over3}
              </Button>
            </div>
            <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <FilterSelect
              label="Объект"
              value={filters.siteName}
              onChange={(v) => setFilters((f) => ({ ...f, siteName: v }))}
              options={filterOptions.siteName}
              testId="filter-siteName"
            />
            <FilterSelect
              label="Адрес"
              value={filters.address}
              onChange={(v) => setFilters((f) => ({ ...f, address: v }))}
              options={filterOptions.address}
              testId="filter-address"
            />
            <FilterSelect
              label="Куст"
              value={filters.branch}
              onChange={(v) => setFilters((f) => ({ ...f, branch: v }))}
              options={filterOptions.branch}
              testId="filter-branch"
            />
            <FilterSelect
              label="Менеджер"
              value={filters.manager}
              onChange={(v) => setFilters((f) => ({ ...f, manager: v }))}
              options={filterOptions.manager}
              testId="filter-manager"
            />
            <FilterSelect
              label="Тип поставки"
              value={filters.deliveryType}
              onChange={(v) => setFilters((f) => ({ ...f, deliveryType: v }))}
              options={filterOptions.deliveryType}
              testId="filter-deliveryType"
            />
            <FilterSelect
              label="Водитель"
              value={filters.driver}
              onChange={(v) => setFilters((f) => ({ ...f, driver: v }))}
              options={filterOptions.driver}
              testId="filter-driver"
            />
            <FilterSelect
              label="ПланДата"
              value={filters.plannedDate}
              onChange={(v) => setFilters((f) => ({ ...f, plannedDate: v }))}
              options={filterOptions.plannedDate}
              testId="filter-plannedDate"
            />
            <FilterSelect
              label="ФактДата"
              value={filters.actualDate}
              onChange={(v) => setFilters((f) => ({ ...f, actualDate: v }))}
              options={filterOptions.actualDate}
              testId="filter-actualDate"
            />
            <FilterSelect
              label="Отклонение"
              value={filters.lagDays}
              onChange={(v) => setFilters((f) => ({ ...f, lagDays: v }))}
              options={filterOptions.lagDays}
              testId="filter-lagDays"
            />
            {Object.values(filters).some(Boolean) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() =>
                  setFilters({
                    siteName: "",
                    address: "",
                    branch: "",
                    manager: "",
                    deliveryType: "",
                    driver: "",
                    client: "",
                    plannedDate: "",
                    actualDate: "",
                    lagDays: "",
                  })
                }
                data-testid="button-reset-filters"
              >
                Сбросить
              </Button>
            )}
            </div>
          </div>

          <div className="mb-2 flex items-center gap-2 shrink-0">
            <div className="relative w-[220px]">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-8 bg-background pl-8 text-xs"
                placeholder="Поиск по части слова..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="input-search-deliveries-workspace"
              />
            </div>
            <Badge variant="secondary" data-testid="counter-workspace-rows">
              Строк: {workspaceTotal}
            </Badge>
          </div>

          <div className="flex-1 overflow-auto border rounded-md relative bg-background">
            <table className="w-[1250px] table-fixed text-sm text-left border-collapse">
              <colgroup>
                <col className="w-[110px]" />
                <col className="w-[165px]" />
                <col className="w-[120px]" />
                <col className="w-[100px]" />
                <col className="w-[240px]" />
                <col className="w-[80px]" />
                <col className="w-[135px]" />
                <col className="w-[100px]" />
                <col className="w-[145px]" />
                <col className="w-[55px]" />
              </colgroup>
              <thead className="sticky top-0 z-30 shadow-[0_1px_0_0_var(--color-border)] bg-muted">
                <tr>
                  <SortHeader
                    label="Объект"
                    field="siteName"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Адрес"
                    field="siteAddress"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Куст"
                    field="siteBranch"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="План дата"
                    field="plannedDate"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <th className="p-2 font-medium whitespace-nowrap">
                    Факт дата
                  </th>
                  <SortHeader
                    label="Отклонение"
                    field="lagDays"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Водитель"
                    field="driver"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Тип поставки"
                    field="siteDeliveryType"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Менеджер"
                    field="siteManager"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <th className="p-2 font-medium whitespace-nowrap">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleSortedData.map((d) => {
                  const tone = getDeliveryCellTone(
                    d.actualDate,
                    d.photosCount,
                    d.workflowStatus,
                  );
                  const cellClass = tone === "green"
                    ? CELL_GREEN
                    : tone === "orange"
                    ? CELL_ORANGE
                    : "";

                  return (
                    <tr
                      key={d.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors group"
                      data-testid={`row-delivery-${d.id}`}
                    >
                      <td
                        className="p-2 truncate"
                        title={d.siteName}
                      >
                        <Link
                          href={`/sites/${d.siteId}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {d.siteName}
                        </Link>
                      </td>
                      <td
                        className="p-2 max-w-[200px] truncate"
                        title={d.siteAddress}
                      >
                        {d.siteAddress}
                      </td>
                      <td className="p-2 truncate" title={d.siteBranch}>
                        {d.siteBranch}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col">
                          {d.plannedDate ? (
                            <span>
                              {dateFormat.format(new Date(d.plannedDate))}
                            </span>
                          ) : (
                            <span className="text-muted-foreground font-medium text-amber-800">Нет плана</span>
                          )}
                          {d.rescheduledFromDate && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <CalendarClock className="h-3 w-3" /> Первоначально:{" "}
                              {dateFormat.format(
                                new Date(d.rescheduledFromDate)
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "p-2 whitespace-nowrap transition-colors",
                          cellClass
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <FactDateCell
                            delivery={d}
                            month={month}
                            onChange={(val) => handleActualDateChange(d, val)}
                            disabled={!canEditDeliveries}
                          />
                          {d.actualDate && (
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-8 px-2 text-xs bg-background",
                                d.photosCount > 0 &&
                                  "border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                              )}
                              onClick={() => setPhotosDelivery(d)}
                              data-testid={`btn-acts-${d.id}`}
                            >
                              {d.photosCount > 0
                                ? `Акты (${d.photosCount})`
                                : "Загрузить"}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-center">
                        {d.lagDays !== null ? (
                          <Badge
                            variant="secondary"
                            className={cn(
                              d.lagDays > 0 &&
                                d.lagDays <= 3 &&
                                "border-orange-400 bg-orange-100 text-orange-900 hover:bg-orange-100",
                              d.lagDays > 3 &&
                                "border-red-500 bg-red-600 text-white hover:bg-red-600",
                            )}
                          >
                            {d.lagDays > 0 ? `+${d.lagDays}` : d.lagDays}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-2 truncate" title={d.siteManager}>
                        {canEditDeliveries && !d.actualDate ? (
                          <Select
                            value={d.driverUserId ?? "__none__"}
                            onValueChange={(val) =>
                              handleDriverChange(d, val === "__none__" ? null : val)
                            }
                          >
                            <SelectTrigger className="h-7 w-[120px] text-xs border-transparent group-hover:border-input bg-transparent hover:bg-background">
                              <div className="truncate">
                                {d.driver || (
                                  <span className="text-muted-foreground">
                                    Нет
                                  </span>
                                )}
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Не назначен</SelectItem>
                              {drivers.map((driver) => (
                                <SelectItem key={driver.id} value={driver.id}>
                                  {driver.name || driver.email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Truck className="h-3.5 w-3.5" /> {d.driver}
                          </span>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {d.siteDeliveryType}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {d.siteManager}
                      </td>
                      <td className="p-2">
                        {(canEditDeliveries || isAdmin) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                data-testid={`btn-options-${d.id}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canEditDeliveries &&
                                canRescheduleDelivery(d.actualDate) && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => openRescheduleDialog(d)}
                                  >
                                    <CalendarClock className="h-4 w-4 mr-2" />{" "}
                                    Перенести
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {canEditDeliveries && (
                                <DropdownMenuItem
                                  onClick={() => openDriverChangeDialog(d)}
                                >
                                  <Truck className="h-4 w-4 mr-2" /> Заменить
                                  водителя
                                </DropdownMenuItem>
                              )}
                              {isAdmin && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => setDeleteTarget(d)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" /> Удалить
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleSitesWithoutDeliveries.map((site) => (
                  <tr
                    key={site.id}
                    className="border-b last:border-0 bg-amber-50/60 hover:bg-amber-100/60 transition-colors"
                    data-testid={`row-site-without-delivery-${site.id}`}
                  >
                    <td className="p-2 truncate" title={site.name}>
                      <Link
                        href={`/sites/${site.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {site.name}
                      </Link>
                    </td>
                    <td className="p-2 max-w-[200px] truncate" title={site.address}>
                      {site.address}
                    </td>
                    <td className="p-2 truncate" title={site.branch}>{site.branch}</td>
                    <td className="p-2 whitespace-nowrap font-medium text-amber-800">
                      Нет плана
                    </td>
                    <td className="p-2 text-center text-muted-foreground">—</td>
                    <td className="p-2 text-center text-muted-foreground">—</td>
                    <td className="p-2 whitespace-nowrap">{site.driver}</td>
                    <td className="p-2 truncate" title={site.deliveryType}>
                      {site.deliveryType}
                    </td>
                    <td className="p-2 truncate" title={site.manager}>{site.manager}</td>
                    <td className="p-2" />
                  </tr>
                ))}
                {sortedData.length === 0 &&
                  sitesWithoutDeliveries.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="p-8 text-center text-muted-foreground"
                    >
                      Нет данных для отображения
                    </td>
                  </tr>
                  )}
              </tbody>
            </table>
          </div>
          <TablePager
            page={workspacePage}
            total={workspaceTotal}
            onPageChange={setWorkspacePage}
          />
        </div>
      )}

      {/* Schedule Tab */}
      {activeTab === "schedule" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex flex-wrap items-center gap-2 mb-3 bg-muted/30 p-2 rounded-md border shrink-0">
            <div className="relative w-[220px]">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs bg-background"
                placeholder="Поиск по части слова..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="input-search-deliveries-schedule"
              />
            </div>
            <Badge variant="secondary" data-testid="counter-schedule-rows">
              Строк: {matrixRows.length}
            </Badge>
            <FilterSelect
              label="Объект"
              value={filters.siteName}
              onChange={(v) => setFilters((f) => ({ ...f, siteName: v }))}
              options={filterOptions.siteName}
            />
            <FilterSelect
              label="Водитель"
              value={filters.driver}
              onChange={(v) => setFilters((f) => ({ ...f, driver: v }))}
              options={filterOptions.driver}
            />
            <FilterSelect
              label="Клиент"
              value={filters.client}
              onChange={(v) => setFilters((f) => ({ ...f, client: v }))}
              options={filterOptions.client}
            />
            {(filters.siteName || filters.driver || filters.client) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() =>
                  setFilters({
                    ...filters,
                    siteName: "",
                    driver: "",
                    client: "",
                  })
                }
              >
                Сбросить
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-auto border rounded-md relative bg-background">
            <table
              className="table-fixed text-sm text-left border-collapse"
              style={{ width: 335 + daysInMonth * 40 }}
            >
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-[125px]" />
                <col className="w-[90px]" />
                {days.map((day) => (
                  <col key={day} className="w-[40px]" />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-30 bg-muted shadow-[0_1px_0_0_var(--color-border)]">
                <tr className="bg-muted">
                  <th className="sticky left-0 z-40 bg-muted w-[120px] min-w-[120px] p-2 font-medium">
                    Объект
                  </th>
                  <th className="sticky left-[120px] z-40 bg-muted w-[125px] min-w-[125px] p-2 font-medium">
                    Водитель
                  </th>
                  <th className="sticky left-[245px] z-40 bg-muted w-[90px] min-w-[90px] p-2 font-medium shadow-[1px_0_0_0_var(--color-border)]">
                    Клиент
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      className="p-1 min-w-[40px] border-l text-center font-medium text-xs"
                    >
                      {d}
                    </th>
                  ))}
                </tr>
                <tr className="bg-muted">
                  <th className="sticky left-0 z-40 bg-muted w-[120px] min-w-[120px] p-1"></th>
                  <th className="sticky left-[120px] z-40 bg-muted w-[125px] min-w-[125px] p-1"></th>
                  <th className="sticky left-[245px] z-40 bg-muted w-[90px] min-w-[90px] p-1 shadow-[1px_0_0_0_var(--color-border)] text-right font-normal">
                    <div className="flex flex-col gap-[1px] text-[10px] leading-none pr-1">
                      <div className="text-muted-foreground">План</div>
                      <div className="text-amber-600 dark:text-amber-400">
                        Выполнено
                      </div>
                      <div className="text-emerald-600 dark:text-emerald-400">
                        Закрыто
                      </div>
                      <div className="text-rose-600 dark:text-rose-400">
                        Не выполнено
                      </div>
                    </div>
                  </th>
                  {days.map((d) => {
                    const t = dayTotals[d - 1];
                    return (
                      <th
                        key={d}
                        className="min-w-[40px] border-l bg-muted p-0.5 align-top font-normal"
                      >
                        <div className="flex flex-col gap-[1px] text-[10px] leading-none text-muted-foreground text-center">
                          <div title="План">{t.plan}</div>
                          <div
                            className="text-amber-600 dark:text-amber-400"
                            title="Выполнено"
                          >
                            {t.done}
                          </div>
                          <div
                            className="text-emerald-600 dark:text-emerald-400"
                            title="Закрыто"
                          >
                            {t.closed}
                          </div>
                          <div
                            className="text-rose-600 dark:text-rose-400"
                            title="Не выполнено"
                          >
                            {t.failed}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleMatrixRows.map((row) => (
                  <tr
                    key={row.key}
                    className="group border-b last:border-0 transition-colors hover:bg-muted/30"
                  >
                    <td
                      className="sticky left-0 z-20 bg-background group-hover:bg-muted/50 w-[120px] min-w-[120px] p-2 truncate font-medium transition-colors"
                      title={row.siteName}
                    >
                      <Link
                        href={`/sites/${row.siteId}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {row.siteName}
                      </Link>
                    </td>
                    <td
                      className="sticky left-[120px] z-20 bg-background group-hover:bg-muted/50 w-[125px] min-w-[125px] p-2 truncate transition-colors"
                      title={row.driver}
                    >
                      {row.driver}
                    </td>
                    <td
                      className="sticky left-[245px] z-20 bg-background group-hover:bg-muted/50 w-[90px] min-w-[90px] p-2 truncate shadow-[1px_0_0_0_var(--color-border)] transition-colors"
                      title={row.client}
                    >
                      {row.client}
                    </td>
                    {days.map((d) => {
                      const dayStr = `${month}-${String(d).padStart(2, "0")}`;
                      const state = getScheduleCellState(
                        row.deliveries,
                        dayStr,
                      );
                      return (
                        <td
                          key={d}
                          className="p-0 border-l relative h-12 min-w-[40px]"
                        >
                          <div className="absolute inset-0 flex items-center justify-center gap-[2px] pointer-events-none">
                            {state.hasPlan && (
                              <span
                                title="План"
                                className="flex rounded-sm bg-slate-300 p-0.5 shadow-sm dark:bg-slate-600"
                              >
                                <X className="h-3.5 w-3.5 text-slate-700 dark:text-slate-100 shrink-0" />
                              </span>
                            )}
                            {(state.hasClosed || state.hasDoneWithAct) && (
                              <span
                                title="Закрыто"
                                className="flex rounded-sm bg-emerald-600 p-0.5 shadow-sm"
                              >
                                <X className="h-3.5 w-3.5 text-white shrink-0" />
                              </span>
                            )}
                            {!state.hasClosed && !state.hasDoneWithAct && state.hasDoneNoAct && (
                              <span
                                title="Выполнено"
                                className="flex rounded-sm bg-orange-500 p-0.5 shadow-sm"
                              >
                                <X className="h-3.5 w-3.5 text-white shrink-0" />
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {matrixRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={3 + days.length}
                      className="p-8 text-center text-muted-foreground"
                    >
                      Нет данных для отображения
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePager
            page={schedulePage}
            total={matrixRows.length}
            onPageChange={setSchedulePage}
          />
          {undatedDeliveries.length > 0 && (
            <div
              ref={undatedSectionRef}
              id="undated-deliveries"
              className="mt-8 mb-4 scroll-mt-4 border border-amber-300 rounded-md p-4 bg-amber-50/40 shrink-0"
              data-testid="section-undated-deliveries"
            >
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                Дата не назначена <Badge variant="secondary">{undatedDeliveries.length}</Badge>
              </h3>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {undatedDeliveries.map((d) => (
                  <div key={d.id} className="border bg-card p-3 rounded-md shadow-sm">
                    <div className="flex justify-between items-start">
                      <div className="font-medium truncate">{d.siteName}</div>
                      {(canEditDeliveries || isAdmin) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 -mr-2 -mt-2">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEditDeliveries && (
                              <DropdownMenuItem onClick={() => openRescheduleDialog(d)}>
                                <CalendarClock className="h-4 w-4 mr-2" /> Назначить дату
                              </DropdownMenuItem>
                            )}
                            {canEditDeliveries && (
                              <DropdownMenuItem onClick={() => openDriverChangeDialog(d)}>
                                <Truck className="h-4 w-4 mr-2" /> Заменить водителя
                              </DropdownMenuItem>
                            )}
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(d)}>
                                  <Trash2 className="h-4 w-4 mr-2" /> Удалить
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate" title={d.siteAddress}>{d.siteAddress}</div>
                    <div className="flex items-center gap-1 mt-2 text-xs">
                      <Truck className="h-3.5 w-3.5" />
                      <span>{d.driver || "Нет водителя"}</span>
                    </div>
                    {d.note && (
                      <div className="mt-2 text-xs italic bg-muted/50 p-1.5 rounded line-clamp-2" title={d.note}>{d.note}</div>
                    )}
                    {canEditDeliveries && (
                      <Button variant="outline" size="sm" className="w-full mt-3 h-7 text-xs bg-background" onClick={() => openRescheduleDialog(d)}>
                        Назначить дату
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <DeliveryPhotosDialog
        delivery={photosDelivery}
        open={!!photosDelivery}
        onOpenChange={(open) => !open && setPhotosDelivery(null)}
        canEdit={canEditDeliveries}
        canApprove={canApproveDeliveryActs}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить доставку?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Запись о доставке будет удалена из
              системы.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteDelivery.mutate({ id: deleteTarget.id })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="btn-confirm-delete"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!rescheduleDeliveryTarget}
        onOpenChange={(open) => !open && closeRescheduleDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rescheduleDeliveryTarget?.plannedDate ? "Перенести доставку" : "Назначить дату доставки"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRescheduleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {rescheduleDeliveryTarget?.plannedDate ? "Новая плановая дата" : "Плановая дата"}
              </label>
              <input
                type="date"
                required
                min={getMonthDateBounds(month).min}
                max={getMonthDateBounds(month).max}
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeRescheduleDialog}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={rescheduleDelivery.isPending || updateDelivery.isPending}>
                {rescheduleDeliveryTarget?.plannedDate ? "Перенести" : "Назначить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!driverChangeTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDriverChangeTarget(null);
            setReplacementDriver("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Заменить водителя</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDriverChangeSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Новый водитель</label>
              <Select
                value={replacementDriver || "__none__"}
                onValueChange={(value) =>
                  setReplacementDriver(value === "__none__" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите водителя" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Не назначен</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name || driver.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDriverChangeTarget(null);
                  setReplacementDriver("");
                }}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={
                  updateDelivery.isPending ||
                  (replacementDriver || null) === driverChangeTarget?.driverUserId
                }
              >
                Заменить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Добавить доставку на {formatMonthLabel(month)}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={handleGenerateSubmit}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="flex-1 overflow-auto border rounded-md">
              <table className="w-full text-sm text-left">
                <thead className="sticky top-0 bg-muted shadow-sm">
                  <tr>
                    <th className="p-2 font-medium">Объект</th>
                    <th className="p-2 font-medium">Водитель</th>
                    <th className="p-2 font-medium">План дата</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row) => (
                    <tr key={row.siteId} className="border-b last:border-0">
                      <td className="p-2">
                        <Select
                          value={row.siteId}
                          onValueChange={(siteId) => {
                            const site = sites?.find((item) => item.id === siteId);
                            if (!site) return;
                            setScheduleRows([
                              {
                                ...row,
                                siteId: site.id,
                                siteName: site.name,
                                driverUserId: site.driverUserId ?? "",
                              },
                            ]);
                          }}
                        >
                          <SelectTrigger className="h-8 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(sites ?? []).filter((site) => !site.isClosed).map((site) => (
                              <SelectItem key={site.id} value={site.id}>
                                {site.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Select
                          value={row.driverUserId || "__none__"}
                          onValueChange={(value) =>
                            updateScheduleRow(row.siteId, {
                              driverUserId: value === "__none__" ? "" : value,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Не назначен</SelectItem>
                            {drivers.map((driver) => (
                              <SelectItem key={driver.id} value={driver.id}>
                                {driver.name || driver.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <input
                          type="date"
                          min={getMonthDateBounds(month).min}
                          max={getMonthDateBounds(month).max}
                          value={row.plannedDate || ""}
                          onChange={(e) =>
                            updateScheduleRow(row.siteId, {
                              plannedDate: e.target.value || null,
                            })
                          }
                          className="h-8 w-32 border rounded px-2 bg-background focus:ring-1 focus:ring-primary outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter className="mt-4 pt-4 border-t shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setGenerateOpen(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={createBulk.isPending}>
                Добавить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingReplacement !== null}
        onOpenChange={(open) => {
          if (!open && !replaceBulk.isPending) setPendingReplacement(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Полностью заменить график месяца?</AlertDialogTitle>
            <AlertDialogDescription>
              Все доставки за {formatMonthLabel(month)}, включая фактические даты
              и прикреплённые акты, будут удалены. Затем будет загружен новый
              график из выбранного файла. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={replaceBulk.isPending}>
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={replaceBulk.isPending || !pendingReplacement}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingReplacement) return;
                replaceBulk.mutate({
                  data: { month, items: pendingReplacement },
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {replaceBulk.isPending ? "Замена..." : "Удалить и загрузить заново"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
