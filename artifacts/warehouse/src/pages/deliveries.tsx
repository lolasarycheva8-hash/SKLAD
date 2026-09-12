import { MobileManagerTable, MobileLogisticianCard } from "@/components/mobile-delivery-cards";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  createOverdueDeliveryBuckets,
  isOverdueBucketId,
  matchesOverdueBucket,
  type OverdueBucketId,
} from "@/lib/overdue-delivery-buckets";
import { hasCorrectedPlan, summarizeCorrectedPlans } from "@/lib/corrected-plan-summary";
import { CorrectedPlanDateCell } from "@/components/corrected-plan-date-cell";
import { DeliveryCreateForm } from "@/components/delivery-create-form";
import { ManagerContactCell } from "@/components/manager-contact-cell";
import { DriverSummarySheet } from "@/components/driver-summary-sheet";
import { buildDriverSummary } from "@/lib/driver-summary";

import {
  useListDeliveries,
  useCreateDelivery,
  useCreateDeliveriesBulk,
  useReplaceDeliveriesBulk,
  useUpdateDelivery,
  useDeleteDelivery,
  useListDeliverySiteLookup,
  useListDrivers,
  useRescheduleDelivery,
  useApproveDeliveryAct,
  updateDeliveriesActualBulk,
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
} from "@/lib/excel-import";
import {
  buildDeliveryFactUpdates,
  deliveryFactExportRows,
  DELIVERY_FACT_HEADERS,
} from "@/lib/delivery-fact-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { DeliveryImportReviewDialog } from "@/components/delivery-import-review-dialog";
import { useToast } from "@/hooks/use-toast";
import { handleAlreadyDeletedDelivery } from "@/lib/delivery-delete-error";
import { downloadFileResponse } from "@/lib/download-file";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import {
  canRescheduleDelivery,
  buildDeliveryImportReview,
  confirmPlannedDate,
  dispatchDeliveryImportByMode,
  formatMonthLabel,
  getDeliveryCellTone,
  getInitialRescheduleDate,
  getMonthDateBounds,
  getScheduleCellState,
  toDateInputValue,
  type DeliveryImportItem,
  type DeliveryImportMode,
  type DeliveryImportReview,
} from "@/lib/delivery-workspace";
import {
  CalendarClock,
  Check,
  AlertTriangle,
  Download,
  FileDown,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
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
const mobileDateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
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

const TEMPLATE_HEADERS = ["Объект", "Водитель", "Email водителя", "Плановая дата"];

const CELL_ORANGE =
  "bg-amber-100/60 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200";
const CELL_GREEN =
  "bg-emerald-100/60 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200";
const CELL_BLUE =
  "bg-blue-100/60 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200";
const TABLE_PAGE_SIZE = 500;

export type JoinedDelivery = Delivery & {
  siteAddress: string;
  siteBranch: string;
  siteManager: string;
  siteManagerContact: string;
  siteDeliveryType: string;
  siteFeatures: string;
  siteClient: string;
};

type ScheduleDayFilter = {
  day: number;
  status: "plan" | "done" | "closed" | "failed";
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
  const handleDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.value);
    event.currentTarget.blur();
  };

  if (delivery.actualDate) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="date"
          min={minDate}
          max={maxDate}
          disabled={disabled}
          value={toDateInputValue(delivery.actualDate)}
          onChange={handleDateChange}
          className="h-8 w-[108px] rounded border bg-background px-1.5 text-xs shadow-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          data-testid={`input-actual-date-${delivery.id}`}
        />
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onChange("")}
            title="Очистить фактическую дату"
            aria-label={`Очистить фактическую дату доставки для объекта ${delivery.siteName}`}
            data-testid={`button-clear-actual-date-${delivery.id}`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
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
        onChange={handleDateChange}
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

function DateFilter({
  label,
  value,
  month,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  month?: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  const { min, max } = month ? getMonthDateBounds(month) : { min: undefined, max: undefined };

  return (
    <label
      className={cn(
        "flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs",
        value && "border-primary",
      )}
    >
      <span className={cn("whitespace-nowrap text-muted-foreground", value && "text-primary")}>
        {label}
      </span>
      <Input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-[125px] border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
        aria-label={label}
        data-testid={testId}
      />
    </label>
  );
}

function DeliverySummaryBadges({
  plan,
  done,
  closed,
  failed,
}: {
  plan: number;
  done: number;
  closed: number;
  failed: number;
}) {
  const formatPercent = (value: number) =>
    plan > 0
      ? `${((value / plan) * 100).toLocaleString("ru-RU", {
          maximumFractionDigits: 1,
        })}%`
      : "0%";

  const items = [
    {
      key: "plan",
      label: "План",
      value: plan,
      percent: plan > 0 ? "100%" : "0%",
      className: "border-slate-300 bg-slate-50 text-slate-950",
      percentClassName: "bg-slate-200 text-slate-950",
    },
    {
      key: "done",
      label: "Выполнено",
      value: done,
      percent: formatPercent(done),
      className: "border-orange-200 bg-orange-50 text-orange-800",
      percentClassName: "bg-orange-100 text-orange-900",
    },
    {
      key: "closed",
      label: "Закрыто",
      value: closed,
      percent: formatPercent(closed),
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
      percentClassName: "bg-emerald-100 text-emerald-900",
    },
    {
      key: "failed",
      label: "Не выполнено",
      value: failed,
      percent: formatPercent(failed),
      className: "border-red-200 bg-red-50 text-red-700",
      percentClassName: "bg-red-100 text-red-800",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Итоги доставок">
      {items.map((item) => (
        <div
          key={item.key}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-bold",
            item.className,
          )}
          data-testid={`delivery-summary-${item.key}`}
        >
          <span>{item.label}</span>
          <span className="font-bold">{item.value} шт.</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-bold",
              item.percentClassName,
            )}
          >
            {item.percent}
          </span>
        </div>
      ))}
    </div>
  );
}

function SortHeader({
  label,
  field,
  sortConfig,
  onSort,
  className,
}: {
  label: string;
  field: string;
  sortConfig: { field: string; dir: "asc" | "desc" };
  onSort: (f: string) => void;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "p-2 text-center align-middle text-[11px] font-medium leading-tight cursor-pointer hover:bg-muted/50 transition-colors",
        className,
      )}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center justify-center gap-1">
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
  const [activeTab, setActiveTab] = useState<"workspace" | "drivers" | "schedule">("workspace");
  const [month, setMonth] = useState(() => {
    const requestedMonth = initialParams.get("month");
    return requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
      ? requestedMonth
      : currentMonthValue();
  });
  const resumeImportMode: DeliveryImportMode =
    initialParams.get("importMode") === "add" ? "add" : "replace";
  const [showResumeImportHint, setShowResumeImportHint] = useState(
    initialParams.get("resumeImport") === "1",
  );
  const [search, setSearch] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState<
    | "no-deliveries"
    | "undated"
    | "completed"
    | "incomplete"
    | "corrected-plan"
    | OverdueBucketId
    | null
  >(() => {
    const requestedView = initialParams.get("view");
    if (requestedView === "undated") return "undated";
    return isOverdueBucketId(requestedView) ? requestedView : null;
  });
  const [workspacePage, setWorkspacePage] = useState(1);
  const [schedulePage, setSchedulePage] = useState(1);
  const [scheduleDayFilter, setScheduleDayFilter] =
    useState<ScheduleDayFilter | null>(null);

  const [filters, setFilters] = useState({
    siteName: "",
    address: "",
    branch: "",
    manager: "",
    deliveryType: "",
    driver: "",
    client: "",
    plannedDate: "",
    correctedPlannedDate: "",
    actualDate: "",
    lagDays: "",
  });

  const [sortConfig, setSortConfig] = useState<{
    field: string;
    dir: "asc" | "desc";
  }>({ field: "siteName", dir: "asc" });

  const [generateOpen, setGenerateOpen] = useState(false);
  const [actsExportOpen, setActsExportOpen] = useState(false);
  const [actsExportFrom, setActsExportFrom] = useState("");
  const [actsExportTo, setActsExportTo] = useState("");
  const [actsExportPending, setActsExportPending] = useState(false);
  const [importMode, setImportMode] = useState<DeliveryImportMode>("replace");
  const [pendingReplacement, setPendingReplacement] = useState<
    DeliveryImportItem[] | null
  >(null);
  const [pendingImportReview, setPendingImportReview] =
    useState<DeliveryImportReview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Delivery | null>(null);
  const [photosDelivery, setPhotosDelivery] = useState<Delivery | null>(null);
  const [rescheduleDeliveryTarget, setRescheduleDeliveryTarget] =
    useState<Delivery | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>("");
  const [driverChangeTarget, setDriverChangeTarget] = useState<Delivery | null>(
    null
  );
  const [replacementDriver, setReplacementDriver] = useState("");
  const [logisticianNoteTarget, setLogisticianNoteTarget] =
    useState<Delivery | null>(null);
  const [logisticianNoteDraft, setLogisticianNoteDraft] = useState("");
  const [driverCommentTarget, setDriverCommentTarget] =
    useState<Delivery | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const factFileInputRef = useRef<HTMLInputElement>(null);
  const [importingFacts, setImportingFacts] = useState(false);
  const { user, canEdit, isAdmin, canApproveDeliveryActs } = usePermissions();
  const canEditDeliveries = canEdit("deliveries");
  const canEditCorrectedPlan =
    canEditDeliveries && (isAdmin || user?.role === "logistician");
  const canEditLogisticianNote =
    user?.role === "logistician" && canEditDeliveries;
  const hasSimplifiedMobileDeliveryView =
    user?.role === "logistician" || user?.role === "manager";

  function openActsExportDialog() {
    const { min, max } = getMonthDateBounds(month);
    setActsExportFrom(min);
    setActsExportTo(max);
    setActsExportOpen(true);
  }

  async function handleActsExport(event: React.FormEvent) {
    event.preventDefault();
    if (!actsExportFrom || !actsExportTo || actsExportPending) return;
    setActsExportPending(true);
    try {
      const query = new URLSearchParams({
        from: actsExportFrom,
        to: actsExportTo,
      });
      await downloadFileResponse(
        `/api/deliveries/acts/download?${query}`,
        `акты-${actsExportFrom}-${actsExportTo}.zip`,
      );
      setActsExportOpen(false);
      toast({ title: "Скачивание архива начато" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Повторите попытку";
      toast({
        title: message.includes("не найдены")
          ? "За выбранный период актов нет"
          : "Не удалось выгрузить акты",
        description: message,
        variant: message.includes("не найдены") ? "default" : "destructive",
      });
    } finally {
      setActsExportPending(false);
    }
  }

  const { data: deliveries, isLoading: deliveriesLoading, isError: deliveriesError, refetch: refetchDeliveries } = useListDeliveries({ month });
  const { data: sites } = useListDeliverySiteLookup();
  const { data: drivers = [], isLoading: driversLoading, isError: driversError, refetch: refetchDrivers } = useListDrivers();

  const driverSummaryRows = useMemo(
    () => buildDriverSummary(deliveries ?? [], drivers, month),
    [deliveries, drivers, month],
  );

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
        siteManagerContact: s?.managerContact || "",
        siteDeliveryType: d.deliveryType ?? s?.deliveryType ?? "",
        siteFeatures: s?.features || "",
        siteClient: s?.client || "",
      };
    });
  }, [deliveries, sites]);

  const filteredData = useMemo(() => {
    return joinedData.filter((d) => {
      if (workspaceStatus === "no-deliveries") return false;
      if (workspaceStatus === "undated" && d.plannedDate) return false;
      if (workspaceStatus === "completed" && !d.actualDate) return false;
      if (workspaceStatus === "incomplete" && d.actualDate) return false;
      if (workspaceStatus === "corrected-plan" && !hasCorrectedPlan(d)) return false;
      if (
        isOverdueBucketId(workspaceStatus) &&
        !matchesOverdueBucket(d.lagDays, workspaceStatus)
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
          d.siteManagerContact,
          d.siteDeliveryType,
          d.siteFeatures,
          d.driver,
          d.siteClient,
          d.plannedDate,
          d.correctedPlannedDate,
          d.actualDate,
          d.lagDays,
          d.logisticianNote,
          d.note,
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
      if (
        filters.plannedDate &&
        toDateInputValue(d.plannedDate) !== filters.plannedDate
      )
        return false;
      if (
        filters.correctedPlannedDate &&
        toDateInputValue(d.correctedPlannedDate ?? null) !== filters.correctedPlannedDate
      )
        return false;
      if (
        filters.actualDate &&
        toDateInputValue(d.actualDate) !== filters.actualDate
      )
        return false;
      if (filters.lagDays && String(d.lagDays) !== filters.lagDays) return false;
      return true;
    });
  }, [joinedData, filters, search, workspaceStatus]);

  const scheduleFilteredData = useMemo(() => {
    if (!scheduleDayFilter) return filteredData;

    const dayStr = `${month}-${String(scheduleDayFilter.day).padStart(2, "0")}`;
    return filteredData.filter((delivery) => {
      const plannedForDay =
        toDateInputValue(delivery.plannedDate) === dayStr;
      const completedOnDay =
        toDateInputValue(delivery.actualDate) === dayStr;

      if (scheduleDayFilter.status === "plan") return plannedForDay;
      if (scheduleDayFilter.status === "failed") {
        return plannedForDay && !delivery.actualDate;
      }
      if (scheduleDayFilter.status === "closed") {
        return completedOnDay && delivery.photosCount > 0;
      }
      return completedOnDay && delivery.photosCount === 0;
    });
  }, [filteredData, month, scheduleDayFilter]);

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
            site.managerContact,
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
        if (filters.plannedDate || filters.correctedPlannedDate || filters.actualDate || filters.lagDays)
          return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [filters, joinedData, search, sites, workspaceStatus]);

  const overdueBuckets = useMemo(
    () =>
      createOverdueDeliveryBuckets(
        joinedData,
        joinedData.filter((delivery) => delivery.plannedDate).length,
      ),
    [joinedData],
  );
  const correctedPlanSummary = useMemo(
    () => summarizeCorrectedPlans(joinedData),
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

  const createDelivery = useCreateDelivery({
    mutation: {
      onSuccess: () => {
        invalidate();
        setGenerateOpen(false);
        toast({ title: "Доставка добавлена" });
      },
      onError: (error) => {
        toast({
          title: "Не удалось добавить доставку",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

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
        if (
          handleAlreadyDeletedDelivery(error, {
            invalidate,
            closeStaleDialog: () => {
              closeRescheduleDialog();
              closeLogisticianNoteDialog();
            },
            notify: toast,
          })
        )
          return;

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
        if (
          handleAlreadyDeletedDelivery(error, {
            invalidate,
            closeStaleDialog: closeRescheduleDialog,
            notify: toast,
          })
        )
          return;

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
        if (
          handleAlreadyDeletedDelivery(error, {
            invalidate,
            closeStaleDialog: () => setDeleteTarget(null),
            notify: toast,
          })
        )
          return;

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

  function submitImportedItems(
    items: DeliveryImportItem[],
    mode: DeliveryImportMode = importMode,
  ) {
    dispatchDeliveryImportByMode(items, mode, {
      replace: setPendingReplacement,
      add: (validItems) => createBulk.mutate({ data: { items: validItems } }),
    });
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setShowResumeImportHint(false);

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
      const { items, skippedRows } = buildDeliveryImportReview(
        rows,
        month,
        sites ?? [],
        drivers,
      );

      if (items.length === 0 && skippedRows.length === 0) {
        toast({
          title: "Файл пуст",
          description: "В файле нет строк для загрузки.",
          variant: "destructive",
        });
        return;
      }

      if (skippedRows.length > 0) {
        setPendingImportReview({ items, skippedRows });
      } else {
        submitImportedItems(items);
      }
    } catch (error) {
      toast({
        title: "Не удалось прочитать файл",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }

  function handleExportFacts() {
    const rows = deliveryFactExportRows(deliveries ?? []);
    exportRowsToExcel(
      rows,
      DELIVERY_FACT_HEADERS,
      `факт-доставок-${month}.xlsx`,
    );
  }

  async function handleImportFacts(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const headers = await readSheetHeaders(file);
      const missing = validateTemplateHeaders(headers, DELIVERY_FACT_HEADERS);
      if (missing.length > 0) {
        toast({
          title: "Неверный формат файла",
          description: `Не хватает колонок: ${missing.join(", ")}. Выгрузите шаблон факта и заполните колонку «Дата факта».`,
          variant: "destructive",
        });
        return;
      }

      const fileRows = await parseExcelFile(file);
      const { updates, unmatched } = buildDeliveryFactUpdates(
        fileRows,
        deliveries ?? [],
      );
      if (updates.length === 0) {
        toast({
          title: "Нет изменений",
          description:
            unmatched.length > 0
              ? `Совпадений не найдено для: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? "…" : ""}`
              : "В файле нет новых отметок «Дата факта».",
        });
        return;
      }

      setImportingFacts(true);
      const result = await updateDeliveriesActualBulk({ items: updates });
      invalidate();
      const parts = [`Обновлено доставок: ${result.updated}`];
      if (unmatched.length > 0) parts.push(`не найдено: ${unmatched.length}`);
      toast({
        title: "Факт за период загружен",
        description: parts.join(", "),
      });
    } catch (error) {
      toast({
        title: "Не удалось загрузить факт",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setImportingFacts(false);
    }
  }

  function handleExport() {
    const rows = sortedData.map((d) => ({
      Объект: d.siteName,
      Адрес: d.siteAddress,
      Куст: d.siteBranch,
      Менеджер: [d.siteManager, d.siteManagerContact].filter(Boolean).join("\n"),
      Водитель: d.driver,
      "Тип поставки": d.siteDeliveryType,
      "Email водителя": drivers.find((driver) => driver.id === d.driverUserId)?.email ?? "",
      "Плановая дата": d.plannedDate ? d.plannedDate.slice(0, 10) : "",
      "ДатаПланКорр": d.correctedPlannedDate?.slice(0, 10) ?? "",
      "Фактическая дата": d.actualDate ? d.actualDate.slice(0, 10) : "",
      Отклонение: d.lagDays !== null ? d.lagDays : "",
      "Примечание логиста": d.logisticianNote ?? "",
      "Комментарий водителя": d.note ?? "",
    }));
    exportRowsToExcel(
      rows,
      [
        "Объект",
        "Адрес",
        "Куст",
        "Менеджер",
        "Водитель",
        "Тип поставки",
        "Email водителя",
        "Плановая дата",
        "ДатаПланКорр",
        "Фактическая дата",
        "Отклонение",
        "Примечание логиста",
        "Комментарий водителя",
      ],
      "рабочее-место-логиста.xlsx"
    );
  }

  function openGenerateDialog() {
    const site = sites?.find((item) => !item.isClosed);
    if (!site) return;
    setGenerateOpen(true);
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

  function openLogisticianNoteDialog(delivery: Delivery) {
    if (!canEditLogisticianNote) return;
    setLogisticianNoteTarget(delivery);
    setLogisticianNoteDraft(delivery.logisticianNote ?? "");
  }

  function closeLogisticianNoteDialog() {
    setLogisticianNoteTarget(null);
    setLogisticianNoteDraft("");
  }

  function handleLogisticianNoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!logisticianNoteTarget) return;
    updateDelivery.mutate(
      {
        id: logisticianNoteTarget.id,
        data: { logisticianNote: logisticianNoteDraft.trim() || null },
      },
      {
        onSuccess: () => {
          closeLogisticianNoteDialog();
          toast({ title: "Примечание сохранено" });
        },
      },
    );
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
    for (const d of scheduleFilteredData) {
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
  }, [scheduleFilteredData]);

  const undatedCount = useMemo(
    () => joinedData.filter((d) => !d.plannedDate).length,
    [joinedData],
  );

  const deliverySummary = useMemo(() => {
    let plan = 0;
    let done = 0;
    let closed = 0;
    let failed = 0;

    for (const delivery of filteredData) {
      if (!delivery.plannedDate) continue;
      plan++;

      if (!delivery.actualDate) {
        failed++;
      } else if (
        delivery.workflowStatus === "closed" ||
        delivery.photosCount > 0
      ) {
        closed++;
      } else {
        done++;
      }
    }

    return { plan, done, closed, failed };
  }, [filteredData]);

  function showUndatedDeliveries() {
    setActiveTab("workspace");
    setWorkspaceStatus((status) => (status === "undated" ? null : "undated"));
  }

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
    filters.correctedPlannedDate,
    filters.actualDate,
    scheduleDayFilter,
  ]);

  useEffect(() => {
    setScheduleDayFilter(null);
  }, [month]);

  function toggleScheduleDayFilter(
    day: number,
    status: ScheduleDayFilter["status"],
  ) {
    setScheduleDayFilter((current) =>
      current?.day === day && current.status === status
        ? null
        : { day, status },
    );
  }

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
      {isAdmin && showResumeImportHint && (
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="delivery-import-resume-hint"
        >
          <div>
            <div className="font-semibold">Повторите импорт доставок</div>
            <div>
              После добавления объектов повторно выберите исходный Excel-файл.
              Старый файл не загружается частично.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setImportMode(resumeImportMode);
              fileInputRef.current?.click();
            }}
            data-testid="button-resume-delivery-import"
          >
            <Upload className="mr-2 h-4 w-4" />
            Выбрать Excel-файл
          </Button>
        </div>
      )}
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
              className={cn(
                "border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900",
                activeTab === "workspace" &&
                  workspaceStatus === "undated" &&
                  "bg-amber-500 text-white hover:bg-amber-600 hover:text-white",
              )}
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

          {isAdmin && (
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImportFile}
              data-testid="input-import-deliveries"
            />
          )}
          {isAdmin && (
            <input
              ref={factFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImportFacts}
              data-testid="input-import-delivery-facts"
            />
          )}
          {isAdmin && (
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
          )}
          {isAdmin && (
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
          {isAdmin && (
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
          {canApproveDeliveryActs && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={openActsExportDialog}
              data-testid="button-export-delivery-acts"
            >
              <FileDown className="mr-2 h-4 w-4" />
              Выгрузить акты за период
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={handleExportFacts}
              disabled={!deliveries?.some((delivery) => delivery.plannedDate)}
              title="Выгрузить все датированные доставки выбранного месяца для заполнения факта"
              data-testid="button-export-delivery-facts"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Шаблон факта
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => factFileInputRef.current?.click()}
              disabled={importingFacts}
              data-testid="button-import-delivery-facts"
            >
              <Upload className="h-4 w-4 mr-2" />
              {importingFacts ? "Загрузка..." : "Загрузить факт"}
            </Button>
          )}
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
          {isAdmin && (
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
      <div className="flex flex-wrap gap-2 border-b shrink-0 md:gap-4">
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
          ЛОГИСТИКА
        </button>
        <button
          className={cn(
            "px-4 py-2 border-b-2 font-medium transition-colors outline-none",
            activeTab === "drivers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
          onClick={() => setActiveTab("drivers")}
          data-testid="tab-driver-summary"
        >
          Сводка по водителям
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

      {activeTab !== "drivers" && (
        <DeliverySummaryBadges {...deliverySummary} />
      )}

      {activeTab === "drivers" && (
        <DriverSummarySheet
          rows={driverSummaryRows}
          month={month}
          isLoading={deliveriesLoading || driversLoading}
          isError={deliveriesError || driversError}
          onRetry={() => {
            void refetchDeliveries();
            void refetchDrivers();
          }}
        />
      )}

      {/* Workspace Tab */}
      {activeTab === "workspace" && (
        <div className="flex-1 flex w-full min-w-0 flex-col min-h-0">
          {hasSimplifiedMobileDeliveryView && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-2 h-9 w-full justify-between md:hidden"
              onClick={() => setMobileFiltersOpen((open) => !open)}
              aria-expanded={mobileFiltersOpen}
              data-testid="button-toggle-mobile-delivery-filters"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Фильтры
              </span>
              <Badge variant="secondary">
                {Object.values(filters).filter(Boolean).length +
                  (workspaceStatus ? 1 : 0)}
              </Badge>
            </Button>
          )}
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 mb-3 bg-muted/30 p-2 rounded-md border shrink-0",
              hasSimplifiedMobileDeliveryView &&
                !mobileFiltersOpen &&
                "hidden md:flex",
            )}
          >
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8",
                workspaceStatus === "corrected-plan" &&
                  "border-primary bg-primary/10 text-primary",
              )}
              aria-pressed={workspaceStatus === "corrected-plan"}
              title="Строки с корректировкой и их доля от всех строк с плановой датой за выбранный месяц"
              onClick={() =>
                setWorkspaceStatus((status) =>
                  status === "corrected-plan" ? null : "corrected-plan",
                )
              }
              data-testid="button-filter-corrected-plan"
            >
              План корректировка: {correctedPlanSummary.count} ({correctedPlanSummary.percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%)
            </Button>
            <div className="flex items-center gap-2 border-l-2 border-red-300 pl-3">
              <span className="text-[11px] font-bold uppercase tracking-wide text-red-700">
                Проблемы
              </span>
              {overdueBuckets.map((bucket, index) => (
                <Button
                  key={bucket.id}
                  type="button"
                  size="sm"
                  className={cn(
                    "h-8 border font-bold text-white shadow-md",
                    index === 0 &&
                      "border-orange-700 bg-orange-600 hover:bg-orange-700",
                    index === 1 &&
                      "border-red-800 bg-red-700 hover:bg-red-800",
                    index === 2 &&
                      "border-red-950 bg-red-900 hover:bg-red-950",
                    workspaceStatus === bucket.id &&
                      "ring-2 ring-red-950 ring-offset-2",
                  )}
                  onClick={() =>
                    setWorkspaceStatus((status) =>
                      status === bucket.id ? null : bucket.id,
                    )
                  }
                  data-testid={`button-filter-${bucket.id}`}
                >
                  <AlertTriangle className="mr-1.5 h-4 w-4" />
                  {bucket.label}: {bucket.count}
                </Button>
              ))}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 pb-1">
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
            <DateFilter
              label="План дата"
              value={filters.plannedDate}
              month={month}
              onChange={(v) => setFilters((f) => ({ ...f, plannedDate: v }))}
              testId="filter-plannedDate"
            />
            <DateFilter
              label="План дата коррект"
              value={filters.correctedPlannedDate}
              onChange={(v) => setFilters((f) => ({ ...f, correctedPlannedDate: v }))}
              testId="filter-correctedPlannedDate"
            />
            <DateFilter
              label="Факт дата"
              value={filters.actualDate}
              month={month}
              onChange={(v) => setFilters((f) => ({ ...f, actualDate: v }))}
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
                    correctedPlannedDate: "",
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

          {hasSimplifiedMobileDeliveryView && (
            <div className="md:hidden flex flex-col flex-1 min-h-0">
              {user?.role === "logistician" && canEditDeliveries ? (
                <div className="flex-1 overflow-y-auto px-1 py-1 min-h-0">
                  {visibleSortedData.length === 0 && visibleSitesWithoutDeliveries.length === 0 && (
                    <p className="p-6 text-center text-muted-foreground">Нет данных для отображения</p>
                  )}
                  {visibleSortedData.map((delivery) => (
                    <MobileLogisticianCard
                      key={delivery.id}
                      delivery={delivery}
                      month={month}
                      onUpdateActualDate={async (id, date) => {
                        await updateDelivery.mutateAsync({ id, data: { actualDate: date || null }});
                        toast({ title: date ? "Факт доставки сохранён" : "Фактическая дата очищена" });
                      }}
                      onOpenPhotos={(d) => setPhotosDelivery(d)}
                      onOpenDriverComment={(d) => setDriverCommentTarget(d)}
                    />
                  ))}
                  {visibleSitesWithoutDeliveries.length > 0 && (
                    <div className="mt-4 pt-2 border-t">
                      <h4 className="text-sm font-medium text-muted-foreground mb-2 px-1">Объекты без доставок</h4>
                      <MobileManagerTable
                        data={[]}
                        sitesWithoutDeliveries={visibleSitesWithoutDeliveries}
                        canEditCorrectedPlan={canEditCorrectedPlan}
                        setDriverCommentTarget={setDriverCommentTarget}
                        mobileDateFormat={mobileDateFormat}
                        CorrectedPlanDateCell={CorrectedPlanDateCell}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <MobileManagerTable
                  data={visibleSortedData}
                  sitesWithoutDeliveries={visibleSitesWithoutDeliveries}
                  canEditCorrectedPlan={canEditCorrectedPlan}
                  setDriverCommentTarget={setDriverCommentTarget}
                  mobileDateFormat={mobileDateFormat}
                  CorrectedPlanDateCell={CorrectedPlanDateCell}
                />
              )}
            </div>
          )}

          <div
            className={cn(
              "relative flex-1 w-full min-w-0 overflow-auto rounded-md border bg-background",
              hasSimplifiedMobileDeliveryView && "hidden md:block",
            )}
          >
            <table className="w-full min-w-[2100px] table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[155px]" />
                <col className="w-[175px]" />
                <col className="w-[120px]" />
                <col className="w-[310px]" />
                <col className="w-[120px]" />
                <col className="w-[150px]" />
                <col className="w-[235px]" />
                <col className="w-[130px]" />
                <col className="w-[210px]" />
                <col className="w-[170px]" />
                <col className="w-[170px]" />
                <col className="w-[170px]" />
                <col className="w-[95px]" />
                <col className="w-[60px]" />
              </colgroup>
              <thead className="sticky top-0 z-30 border-b-2 border-slate-400 bg-slate-200 text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <tr>
                  <SortHeader
                    label="Объект"
                    field="siteName"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    className="sticky left-0 z-40 bg-slate-200 font-bold shadow-[1px_0_0_0_var(--color-border)] hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700"
                  />
                  <SortHeader
                    label="Водитель"
                    field="driver"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    className="font-bold"
                  />
                  <SortHeader
                    label="Куст"
                    field="siteBranch"
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
                    label="План дата"
                    field="plannedDate"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    className="border-x-2 border-sky-400 bg-sky-100 font-bold hover:bg-sky-200 dark:border-sky-600 dark:bg-sky-950 dark:hover:bg-sky-900"
                  />
                  <SortHeader
                    label="ДатаПланКорр"
                    field="correctedPlannedDate"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <th className="border-x-2 border-sky-400 bg-sky-100 p-2 text-center align-middle text-[11px] font-medium leading-tight dark:border-sky-600 dark:bg-sky-950">
                    Факт дата
                  </th>
                  <SortHeader
                    label="Тип поставки"
                    field="siteDeliveryType"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <th className="p-2 text-center align-middle text-[11px] font-medium leading-tight">
                    Особенности
                  </th>
                  <SortHeader
                    label="Менеджер"
                    field="siteManager"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <th className="p-2 text-center align-middle text-[11px] font-medium leading-tight">
                    Примечание логиста
                  </th>
                  <th className="p-2 text-center align-middle text-[11px] font-medium leading-tight">
                    Комментарий водителя
                  </th>
                  <SortHeader
                    label="Отклонение"
                    field="lagDays"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <th className="p-2 text-center align-middle text-[11px] font-medium leading-tight">
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
                        className="sticky left-0 z-20 bg-background p-2 font-bold shadow-[1px_0_0_0_var(--color-border)]"
                        title={d.siteName}
                      >
                        <Link
                          href={`/sites/${d.siteId}`}
                          className="font-bold text-primary hover:underline"
                        >
                          {d.siteName}
                        </Link>
                      </td>
                      <td className="p-2 font-bold" title={d.driver}>
                        {canEditDeliveries && !d.actualDate ? (
                          <Select
                            value={d.driverUserId ?? "__none__"}
                            onValueChange={(val) =>
                              handleDriverChange(d, val === "__none__" ? null : val)
                            }
                          >
                            <SelectTrigger className="h-7 w-[145px] border-transparent bg-transparent text-xs font-bold group-hover:border-input hover:bg-background">
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
                          <span className="flex items-center gap-1 font-bold">
                            <Truck className="h-3.5 w-3.5" /> {d.driver}
                          </span>
                        )}
                      </td>
                      <td className="p-2 truncate" title={d.siteBranch}>
                        {d.siteBranch}
                      </td>
                      <td
                        className="p-2 whitespace-normal break-words leading-snug"
                        title={d.siteAddress}
                      >
                        {d.siteAddress}
                      </td>
                      <td className="border-x-2 border-sky-200 bg-sky-50/40 p-2 dark:border-sky-900 dark:bg-sky-950/20">
                        <div className="flex flex-col">
                          {d.plannedDate ? (
                            <span className="font-bold">
                              {dateFormat.format(new Date(d.plannedDate))}
                            </span>
                          ) : (
                            <>
                              <span className="font-medium text-amber-800">
                                Нет плана
                              </span>
                              {canEditDeliveries && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="mt-1 h-7 w-fit gap-1 border-amber-400 bg-amber-50 px-1.5 text-xs text-amber-900 hover:bg-amber-100"
                                  onClick={() => openRescheduleDialog(d)}
                                  data-testid={`button-assign-planned-date-${d.id}`}
                                  aria-label="Назначить дату"
                                  title="Назначить дату"
                                >
                                  <CalendarClock className="h-3.5 w-3.5" />
                                  Назначить
                                </Button>
                              )}
                            </>
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
                      <td className="p-2 whitespace-nowrap">
                        <CorrectedPlanDateCell
                          deliveryId={d.id}
                          siteName={d.siteName}
                          value={d.correctedPlannedDate}
                          canEdit={canEditCorrectedPlan && Boolean(d.plannedDate || d.correctedPlannedDate)}
                        />
                      </td>
                      <td
                        className={cn(
                          "border-x-2 border-sky-200 bg-sky-50/40 p-2 whitespace-nowrap transition-colors dark:border-sky-900 dark:bg-sky-950/20",
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
                      <td className="p-2 whitespace-nowrap">
                        {d.siteDeliveryType}
                      </td>
                      <td
                        className="max-w-[240px] whitespace-normal break-words p-2 leading-snug"
                        title={d.siteFeatures}
                        data-testid={`text-site-features-${d.id}`}
                      >
                        {d.siteFeatures || "—"}
                      </td>
                      <td className="p-2 whitespace-normal break-words leading-snug">
                        <ManagerContactCell name={d.siteManager} contact={d.siteManagerContact} />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <span
                            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                            title={d.logisticianNote ?? undefined}
                            data-testid={`text-logistician-note-${d.id}`}
                          >
                            {d.logisticianNote || "—"}
                          </span>
                          {canEditLogisticianNote && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => openLogisticianNoteDialog(d)}
                              aria-label={`${d.logisticianNote ? "Изменить" : "Добавить"} примечание к доставке ${d.siteName}`}
                              data-testid={`button-edit-logistician-note-${d.id}`}
                            >
                              <MessageSquareText className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                      <td
                        className="p-2 truncate text-xs text-muted-foreground"
                        title={d.note ?? undefined}
                        data-testid={`text-driver-comment-${d.id}`}
                      >
                        {d.note || "—"}
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
                                    {d.plannedDate
                                      ? "Перенести"
                                      : "Назначить дату"}
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
                    <td className="sticky left-0 z-20 bg-amber-50 p-2 font-bold shadow-[1px_0_0_0_var(--color-border)]" title={site.name}>
                      <Link
                        href={`/sites/${site.id}`}
                        className="font-bold text-primary hover:underline"
                      >
                        {site.name}
                      </Link>
                    </td>
                    <td className="p-2 font-bold">{site.driver}</td>
                    <td className="p-2 truncate" title={site.branch}>{site.branch}</td>
                    <td className="p-2 whitespace-normal break-words leading-snug" title={site.address}>
                      {site.address}
                    </td>
                    <td className="border-x-2 border-sky-200 bg-sky-50/40 p-2 whitespace-nowrap font-bold text-amber-800 dark:border-sky-900 dark:bg-sky-950/20">
                      Нет плана
                    </td>
                    <td className="p-2 text-center text-muted-foreground">—</td>
                    <td className="border-x-2 border-sky-200 bg-sky-50/40 p-2 text-center text-muted-foreground dark:border-sky-900 dark:bg-sky-950/20">—</td>
                    <td className="p-2 truncate" title={site.deliveryType}>
                      {site.deliveryType}
                    </td>
                    <td className="max-w-[240px] whitespace-normal break-words p-2 leading-snug" title={site.features}>
                      {site.features || "—"}
                    </td>
                    <td className="p-2 whitespace-normal break-words leading-snug">
                      <ManagerContactCell name={site.manager} contact={site.managerContact} />
                    </td>
                    <td className="p-2 text-center text-muted-foreground">—</td>
                    <td className="p-2 text-center text-muted-foreground">—</td>
                    <td className="p-2 text-center text-muted-foreground">—</td>
                    <td className="p-2" />
                  </tr>
                ))}
                {sortedData.length === 0 &&
                  sitesWithoutDeliveries.length === 0 && (
                  <tr>
                    <td
                      colSpan={14}
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
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
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
            {(filters.siteName ||
              filters.driver ||
              filters.client ||
              scheduleDayFilter) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setFilters({
                    ...filters,
                    siteName: "",
                    driver: "",
                    client: "",
                  });
                  setScheduleDayFilter(null);
                }}
              >
                Сбросить
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-auto border rounded-md relative bg-background">
            <table
              className="table-fixed text-sm text-left border-collapse"
              style={{ width: 470 + daysInMonth * 40 }}
            >
              <colgroup>
                <col className="w-[160px]" />
                <col className="w-[180px]" />
                <col className="w-[130px]" />
                {days.map((day) => (
                  <col key={day} className="w-[40px]" />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-30 bg-muted shadow-[0_1px_0_0_var(--color-border)]">
                <tr className="bg-muted">
                  <th className="sticky left-0 z-40 w-[160px] min-w-[160px] bg-muted p-2 font-medium">
                    Объект
                  </th>
                  <th className="sticky left-[160px] z-40 w-[180px] min-w-[180px] bg-muted p-2 font-medium">
                    Водитель
                  </th>
                  <th className="sticky left-[340px] z-40 w-[130px] min-w-[130px] bg-muted p-2 font-medium shadow-[1px_0_0_0_var(--color-border)]">
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
                  <th className="sticky left-0 z-40 w-[160px] min-w-[160px] bg-muted p-1"></th>
                  <th className="sticky left-[160px] z-40 w-[180px] min-w-[180px] bg-muted p-1"></th>
                  <th className="sticky left-[340px] z-40 w-[130px] min-w-[130px] bg-muted p-1 text-right font-normal shadow-[1px_0_0_0_var(--color-border)]">
                    <div className="flex flex-col gap-[1px] text-[10px] leading-none pr-1">
                      <div className="text-amber-600 dark:text-amber-400">Выполнено, %</div>
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
                    const dayValues = [
                      {
                        status: "plan" as const,
                        value: t.plan,
                        label: "План",
                        className: "text-muted-foreground",
                      },
                      {
                        status: "done" as const,
                        value: t.done,
                        label: "Выполнено",
                        className: "text-amber-600 dark:text-amber-400",
                      },
                      {
                        status: "closed" as const,
                        value: t.closed,
                        label: "Закрыто",
                        className: "text-emerald-600 dark:text-emerald-400",
                      },
                      {
                        status: "failed" as const,
                        value: t.failed,
                        label: "Не выполнено",
                        className: "text-rose-600 dark:text-rose-400",
                      },
                    ];
                    return (
                      <th
                        key={d}
                        className="min-w-[40px] border-l bg-muted p-0.5 align-top font-normal"
                      >
                        <div className="flex flex-col gap-[1px] text-[10px] leading-none text-center">
                          <span
                            className="text-amber-600 dark:text-amber-400 tabular-nums"
                            data-testid={`schedule-done-percent-${d}`}
                            title={`Выполнено за ${d}-е число ÷ план за ${d}-е число × 100%`}
                            aria-label={`Выполнено, % за ${d}-е число: ${t.plan > 0 ? (t.done / t.plan * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%" : "нет плана"}`}
                          >
                            {t.plan > 0
                              ? `${(t.done / t.plan * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`
                              : "—"}
                          </span>
                          {dayValues.map((item) => {
                            const isActive =
                              scheduleDayFilter?.day === d &&
                              scheduleDayFilter.status === item.status;
                            return (
                              <button
                                key={item.status}
                                type="button"
                                className={cn(
                                  "mx-auto min-w-5 rounded-sm px-0.5 hover:bg-background hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                                  item.className,
                                  isActive &&
                                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground no-underline",
                                )}
                                onClick={() =>
                                  toggleScheduleDayFilter(d, item.status)
                                }
                                title={`${item.label} за ${d}-е число — показать только эти доставки`}
                                aria-label={`${item.label} за ${d}-е число: ${item.value}`}
                                aria-pressed={isActive}
                                data-testid={`button-schedule-${item.status}-${d}`}
                              >
                                {item.value}
                              </button>
                            );
                          })}
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
                      className="sticky left-0 z-20 w-[160px] min-w-[160px] truncate bg-background p-2 font-medium transition-colors group-hover:bg-muted/50"
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
                      className="sticky left-[160px] z-20 w-[180px] min-w-[180px] truncate bg-background p-2 transition-colors group-hover:bg-muted/50"
                      title={row.driver}
                    >
                      {row.driver}
                    </td>
                    <td
                      className="sticky left-[340px] z-20 w-[130px] min-w-[130px] truncate bg-background p-2 shadow-[1px_0_0_0_var(--color-border)] transition-colors group-hover:bg-muted/50"
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
                          className={cn(
                            "p-0 border-l relative h-12 min-w-[40px] transition-colors",
                            (state.hasClosed || state.hasDoneWithAct) &&
                              "bg-emerald-600",
                            !state.hasClosed &&
                              !state.hasDoneWithAct &&
                              state.hasDoneNoAct &&
                              "bg-orange-500",
                            !state.hasClosed &&
                              !state.hasDoneWithAct &&
                              !state.hasDoneNoAct &&
                              state.hasPlan &&
                              "bg-slate-300 dark:bg-slate-600",
                          )}
                        >
                          <div className="absolute inset-0 flex items-center justify-center gap-[2px] pointer-events-none">
                            {state.hasPlan && (
                              <span
                                title="План"
                                className="flex"
                              >
                                <X
                                  className={cn(
                                    "h-4 w-4 shrink-0",
                                    state.hasClosed ||
                                      state.hasDoneWithAct ||
                                      state.hasDoneNoAct
                                      ? "text-white"
                                      : "text-slate-700 dark:text-slate-100",
                                  )}
                                />
                              </span>
                            )}
                            {(state.hasClosed || state.hasDoneWithAct) && (
                              <span
                                title="Закрыто"
                                className="flex"
                              >
                                <X className="h-4 w-4 text-white shrink-0" />
                              </span>
                            )}
                            {!state.hasClosed && !state.hasDoneWithAct && state.hasDoneNoAct && (
                              <span
                                title="Выполнено"
                                className="flex"
                              >
                                <X className="h-4 w-4 text-white shrink-0" />
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
        </div>
      )}

      {/* Dialogs */}
      <Dialog
        open={!!logisticianNoteTarget}
        onOpenChange={(open) => !open && closeLogisticianNoteDialog()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Примечание для водителя</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLogisticianNoteSubmit} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {logisticianNoteTarget?.siteName}
            </div>
            <Textarea
              value={logisticianNoteDraft}
              onChange={(event) => setLogisticianNoteDraft(event.target.value)}
              placeholder="Напишите водителю важную информацию по доставке..."
              rows={5}
              data-testid="textarea-logistician-note"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeLogisticianNoteDialog}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={updateDelivery.isPending}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!driverCommentTarget}
        onOpenChange={(open) => !open && setDriverCommentTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Комментарий водителя</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {driverCommentTarget?.siteName}
            </p>
            <p
              className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm"
              data-testid="text-mobile-driver-comment-dialog"
            >
              {driverCommentTarget?.note}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setDriverCommentTarget(null)}
            >
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeliveryPhotosDialog
        delivery={photosDelivery}
        open={!!photosDelivery}
        onOpenChange={(open) => !open && setPhotosDelivery(null)}
        canEdit={canEditDeliveries}
        canApprove={canApproveDeliveryActs}
        canDownload={canApproveDeliveryActs}
      />

      <Dialog open={actsExportOpen} onOpenChange={setActsExportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Выгрузить акты за период</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleActsExport}>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">С даты</span>
                <Input
                  type="date"
                  value={actsExportFrom}
                  onChange={(event) => setActsExportFrom(event.target.value)}
                  required
                  data-testid="input-acts-export-from"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">По дату</span>
                <Input
                  type="date"
                  value={actsExportTo}
                  onChange={(event) => setActsExportTo(event.target.value)}
                  required
                  data-testid="input-acts-export-to"
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setActsExportOpen(false)}
                disabled={actsExportPending}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={actsExportPending}>
                {actsExportPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {actsExportPending ? "Формируем..." : "Скачать ZIP"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeliveryImportReviewDialog
        review={pendingImportReview}
        mode={importMode}
        onCancel={() => setPendingImportReview(null)}
        onAddMissingSites={() => {
          setPendingImportReview(null);
          const params = new URLSearchParams({
            add: "1",
            fromDeliveryImport: "1",
            month,
            importMode,
          });
          setLocation(`/sites?${params.toString()}`);
        }}
        onConfirm={(items, confirmedMode) => {
          setPendingImportReview(null);
          submitImportedItems(items, confirmedMode);
        }}
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

      <Dialog
        open={generateOpen}
        onOpenChange={(open) => {
          if (!createDelivery.isPending) setGenerateOpen(open);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Добавить доставку на {formatMonthLabel(month)}</DialogTitle>
          </DialogHeader>
          {generateOpen && (
            <DeliveryCreateForm
              sites={sites ?? []}
              drivers={drivers}
              month={month}
              isPending={createDelivery.isPending}
              onCancel={() => setGenerateOpen(false)}
              onSubmit={(item) => {
                if (!createDelivery.isPending) {
                  createDelivery.mutate({ data: item });
                }
              }}
            />
          )}
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
