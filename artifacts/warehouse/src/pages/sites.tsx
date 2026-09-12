import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { CreatableSiteLookup } from "@/components/creatable-site-lookup";
import {
  useListSites,
  useListSiteBranchLookup,
  getListSiteBranchLookupQueryKey,
  useCreateSite,
  useUpdateSite,
  useDeleteSite,
  useCreateSitesBulk,
  getListSitesQueryKey,
  useListTradeNames,
  useListDeliveryTypes,
  useListOrderClientLookup,
  useListDrivers,
  useCreateTradeName,
  useDeleteTradeName,
  getListTradeNamesQueryKey,
  useGetLegacyDriverAssignments,
  getGetLegacyDriverAssignmentsQueryKey,
  useListSiteChangeRequests,
  useApproveSiteChangeRequest,
  useRejectSiteChangeRequest,
  getListSiteChangeRequestsQueryKey,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Site } from "@workspace/api-client-react";
import {
  parseExcelFile,
  readSheetHeaders,
  validateTemplateHeaders,
  downloadTemplate,
  exportRowsToEditableCsv,
  str,
  num,
} from "@/lib/excel-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  SortableHeader,
  type SortDirection,
} from "@/components/sortable-header";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Upload,
  Download,
  FileDown,
  X,
  Lock,
  Unlock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
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
import { CloseSiteDialog } from "@/components/close-site-dialog";
import { LegacyDriverMappingDialog } from "@/components/legacy-driver-mapping-dialog";
import { useReopenSite } from "@workspace/api-client-react";
import {
  getImportDriverOptions,
  resolveImportDriver,
} from "@/lib/driver-import";
import {
  canonicalizeClientName,
  resolveImportClient,
} from "@/lib/client-import";

type FormState = {
  name: string;
  address: string;
  branch: string;
  customer: string;
  client: string;
  clientId: string;
  manager: string;
  managerContact: string;
  director: string;
  project: string;
  driverUserId: string;
  deliveryType: string;
  features: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  address: "",
  branch: "",
  customer: "",
  client: "",
  clientId: "",
  manager: "",
  managerContact: "",
  director: "",
  project: "",
  driverUserId: "",
  deliveryType: "",
  features: "",
};

const TEMPLATE_HEADERS = [
  "Название",
  "Адрес",
  "Куст",
  "Торговое название объекта",
  "Клиент",
  "Менеджер",
  "Контакт менеджера",
  "Руководитель",
  "Проект",
  "Водитель",
  "Тип поставки",
  "Особенности",
];
const EXPORT_HEADERS = ["ID объекта", ...TEMPLATE_HEADERS];

const FILTER_FIELDS: { key: keyof Site; label: string }[] = [
  { key: "branch", label: "Куст" },
  { key: "customer", label: "Торговое название объекта" },
  { key: "client", label: "Клиент" },
  { key: "manager", label: "Менеджер" },
  { key: "director", label: "Руководитель" },
  { key: "driver", label: "Водитель" },
  { key: "deliveryType", label: "Тип поставки" },
];

type SortField =
  | "name"
  | "address"
  | "branch"
  | "customer"
  | "client"
  | "manager"
  | "director"
  | "project"
  | "driver"
  | "deliveryType"
  | "createdAt";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const DEFAULT_SITE_PAGE_SIZE = 250;
const SITE_PAGE_SIZE_OPTIONS = [100, 250, 500] as const;
const CHANGE_FIELD_LABELS: Record<string, string> = {
  name: "Название",
  address: "Адрес",
  branch: "Куст",
  customer: "Торговое название",
  clientId: "Клиент",
  manager: "Менеджер",
  managerContact: "Контакт менеджера",
  director: "Руководитель",
  project: "Проект",
  driverUserId: "Водитель",
  deliveryType: "Тип поставки",
};

export default function Sites() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);
  const [closeTarget, setCloseTarget] = useState<Site | null>(null);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_SITE_PAGE_SIZE);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const routeParams = useMemo(
    () => new URLSearchParams(searchString),
    [searchString],
  );
  const isDeliveryImportFlow =
    routeParams.get("fromDeliveryImport") === "1";
  const deliveryImportMonth = routeParams.get("month");
  const deliveryImportMode =
    routeParams.get("importMode") === "add" ? "add" : "replace";
  const clientIdFilter = useMemo(
    () => routeParams.get("clientId"),
    [routeParams],
  );
  const clientNameFilter = useMemo(
    () => routeParams.get("clientName"),
    [routeParams],
  );
  const [editingDriverSiteId, setEditingDriverSiteId] = useState<string | null>(
    null,
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { canEdit, isAdmin, user } = usePermissions();
  const canEditSites = canEdit("sites");
  const hasCompactMobileHeader =
    user?.role === "logistician" || user?.role === "manager";
  const { data: pendingChangeRequests = [] } = useListSiteChangeRequests(
    { status: "pending" },
    {
      query: {
        enabled: isAdmin,
        queryKey: getListSiteChangeRequestsQueryKey({ status: "pending" }),
      },
    },
  );

  const { data: legacyAssignments = [] } = useGetLegacyDriverAssignments({
    query: {
      enabled: isAdmin,
      queryKey: getGetLegacyDriverAssignmentsQueryKey(),
    },
  });

  useEffect(() => {
    if (!canEditSites || routeParams.get("add") !== "1") return;
    setForm(EMPTY_FORM);
    setDialogOpen(true);
    const preservedParams = new URLSearchParams();
    if (isDeliveryImportFlow) {
      preservedParams.set("fromDeliveryImport", "1");
      if (deliveryImportMonth) preservedParams.set("month", deliveryImportMonth);
      preservedParams.set("importMode", deliveryImportMode);
    }
    const search = preservedParams.toString();
    setLocation(search ? `/sites?${search}` : "/sites");
  }, [
    deliveryImportMode,
    deliveryImportMonth,
    canEditSites,
    isDeliveryImportFlow,
    routeParams,
    setLocation,
  ]);

  const { data: tradeNames, isLoading: tradeNamesLoading, isError: tradeNamesError, refetch: refetchTradeNames } = useListTradeNames();
  const {
    data: siteBranches,
    isLoading: siteBranchesLoading,
    isError: siteBranchesError,
    refetch: refetchSiteBranches,
  } = useListSiteBranchLookup({
    query: {
      enabled: dialogOpen && canEditSites,
      queryKey: getListSiteBranchLookupQueryKey(),
    },
  });
  const { data: deliveryTypes } = useListDeliveryTypes();
  const {
    data: clients = [],
    isLoading: clientsLoading,
    isFetching: clientsFetching,
    refetch: refetchClients,
  } = useListOrderClientLookup();
  const [tradeNamesDialogOpen, setTradeNamesDialogOpen] = useState(false);
  const [newTradeName, setNewTradeName] = useState("");

  const createTradeName = useCreateTradeName({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTradeNamesQueryKey() });
        setNewTradeName("");
      },
      onError: (error: any) => {
        toast({
          title: "Ошибка",
          description:
            error?.data?.error ?? error?.response?.data?.error ?? error.message,
          variant: "destructive",
        });
      },
    },
  });

  const deleteTradeName = useDeleteTradeName({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTradeNamesQueryKey() });
      },
      onError: (error: any) => {
        toast({
          title: "Ошибка",
          description:
            error?.data?.error ?? error?.response?.data?.error ?? error.message,
          variant: "destructive",
        });
      },
    },
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const { data: sites, isLoading } = useListSites({
    search: debouncedSearch || undefined,
  });
  const filteredClientName = useMemo(
    () =>
      clientNameFilter ??
      sites?.find((site) => site.clientId === clientIdFilter)?.client ??
      null,
    [clientIdFilter, clientNameFilter, sites],
  );
  const { data: drivers = [], refetch: refetchDrivers } = useListDrivers();
  const importDriverOptions = useMemo(
    () => getImportDriverOptions(drivers),
    [drivers],
  );

  const reopenSite = useReopenSite({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Объект открыт" });
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

  const filteredSites = useMemo(() => {
    let filtered = sites ?? [];
    
    if (!showClosed) {
      filtered = filtered.filter(site => !site.isClosed);
    }

    if (clientIdFilter) {
      filtered = filtered.filter(
        (site) =>
          site.clientId === clientIdFilter ||
          (site.clientId === null &&
            clientNameFilter !== null &&
            canonicalizeClientName(site.client) ===
              canonicalizeClientName(clientNameFilter)),
      );
    }

    filtered = filtered.filter((site) =>
      FILTER_FIELDS.every(({ key }) => {
        const value = fieldFilters[key];
        if (!value) return true;
        return String(site[key] ?? "") === value;
      }),
    );

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "name":
          return a.name.localeCompare(b.name, "ru") * dir;
        case "address":
          return a.address.localeCompare(b.address, "ru") * dir;
        case "branch":
          return a.branch.localeCompare(b.branch, "ru") * dir;
        case "customer":
          return a.customer.localeCompare(b.customer, "ru") * dir;
        case "client":
          return a.client.localeCompare(b.client, "ru") * dir;
        case "manager":
          return a.manager.localeCompare(b.manager, "ru") * dir;
        case "director":
          return a.director.localeCompare(b.director, "ru") * dir;
        case "project":
          return a.project.localeCompare(b.project, "ru") * dir;
        case "driver":
          return a.driver.localeCompare(b.driver, "ru") * dir;
        case "deliveryType":
          return a.deliveryType.localeCompare(b.deliveryType, "ru") * dir;
        case "createdAt":
          return (
            (new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()) *
            dir
          );
        default:
          return 0;
      }
    });
  }, [
    sites,
    clientIdFilter,
    clientNameFilter,
    fieldFilters,
    showClosed,
    sortField,
    sortDir,
  ]);

  const filterOptions = useMemo(
    () =>
      Object.fromEntries(
        FILTER_FIELDS.map(({ key }) => [
          key,
          Array.from(
            new Set(
              (sites ?? [])
                .map((site) => String(site[key] ?? "").trim())
                .filter(Boolean),
            ),
          ).sort((a, b) => a.localeCompare(b, "ru")),
        ]),
      ) as Record<string, string[]>,
    [sites],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(filteredSites.length / pageSize),
  );
  const currentPage = Math.min(page, pageCount);
  const visibleSites = useMemo(
    () =>
      filteredSites.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ),
    [currentPage, filteredSites, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, fieldFilters, showClosed, sortField, sortDir]);

  useEffect(() => {
    if (clientIdFilter) setShowClosed(true);
  }, [clientIdFilter]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const hasActiveFilters =
    Boolean(clientIdFilter) || Object.values(fieldFilters).some(Boolean);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
  };

  const createSite = useCreateSite({
    mutation: {
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getListSiteBranchLookupQueryKey() });
        setDialogOpen(false);
        toast({
          title: "Объект добавлен",
          description: isDeliveryImportFlow
            ? "Добавьте остальные отсутствующие объекты, затем вернитесь к доставкам и повторно выберите Excel-файл."
            : undefined,
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

  const updateSiteDriver = useUpdateSite({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Закреплённый водитель обновлён" });
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

  const deleteSite = useDeleteSite({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteTarget(null);
        toast({ title: "Объект удалён" });
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

  const createSitesBulk = useCreateSitesBulk({
    mutation: {
      onSuccess: (data) => {
        invalidate();
        toast({
          title: "Импорт завершён",
          description: `Обработано объектов: ${data.length}`,
        });
      },
      onError: (error) => {
        toast({
          title: "Ошибка импорта",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const invalidateChangeRequests = () => {
    invalidate();
    queryClient.invalidateQueries({
      queryKey: getListSiteChangeRequestsQueryKey({ status: "pending" }),
    });
  };
  const approveChangeRequest = useApproveSiteChangeRequest({
    mutation: {
      onSuccess: () => {
        invalidateChangeRequests();
        toast({ title: "Предложение принято" });
      },
      onError: (error) =>
        toast({ title: "Ошибка", description: error.message, variant: "destructive" }),
    },
  });
  const rejectChangeRequest = useRejectSiteChangeRequest({
    mutation: {
      onSuccess: () => {
        invalidateChangeRequests();
        toast({ title: "Предложение отклонено" });
      },
      onError: (error) =>
        toast({ title: "Ошибка", description: error.message, variant: "destructive" }),
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
      const clientsResult = await refetchClients();
      if (clientsResult.isError || !clientsResult.data) {
        throw new Error("Не удалось получить актуальный справочник клиентов");
      }
      const items = rows.map((row) => {
        const id = str(row["ID объекта"]).trim();
        const clientName = str(row["Клиент"]).trim();
        const client = resolveImportClient(clientsResult.data, clientName);
        const driver = resolveImportDriver(
          drivers,
          str(row["Водитель"]),
          str(row["Email водителя"]),
        );
        return {
          ...(id ? { id } : {}),
          name: str(row["Название"]),
          address: str(row["Адрес"]),
          branch: str(row["Куст"]),
          customer: str(row["Торговое название объекта"]),
          clientId: client.id,
          manager: str(row["Менеджер"]),
          managerContact: str(row["Контакт менеджера"]),
          director: str(row["Руководитель"]),
          project: str(row["Проект"]),
          driverUserId: driver?.id ?? null,
          deliveryType: str(row["Тип поставки"]),
          features: str(row["Особенности"]),
        };
      });

      if (items.length === 0) {
        toast({ title: "Файл пуст", variant: "destructive" });
        return;
      }

      createSitesBulk.mutate({ data: { items } });
    } catch (error) {
      toast({
        title: "Не удалось прочитать файл",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }

  function handleExport() {
    const rows = (sites ?? []).map((site) => ({
      "ID объекта": site.id,
      Название: site.name,
      Адрес: site.address,
      Куст: site.branch,
      "Торговое название объекта": site.customer,
      Клиент: site.client,
      Менеджер: site.manager,
      "Контакт менеджера": site.managerContact,
      Руководитель: site.director,
      Проект: site.project,
      Водитель:
        importDriverOptions.find((driver) => driver.id === site.driverUserId)
          ?.label ?? "",
      "Тип поставки": site.deliveryType,
      Особенности: site.features,
    }));
    exportRowsToEditableCsv(
      rows,
      EXPORT_HEADERS,
      "объекты-для-редактирования.csv",
    );
  }

  async function handleDownloadTemplate() {
    const [clientsResult, driversResult] = await Promise.all([
      refetchClients(),
      refetchDrivers(),
    ]);
    if (
      clientsResult.isError ||
      !clientsResult.data ||
      driversResult.isError ||
      !driversResult.data
    ) {
      toast({
        title: "Не удалось загрузить справочники",
        description:
          "Шаблон не скачан. Не удалось получить актуальные списки клиентов и водителей.",
        variant: "destructive",
      });
      return;
    }
    const freshDriverOptions = getImportDriverOptions(driversResult.data);

    downloadTemplate(EXPORT_HEADERS, "шаблон-объекты.xlsx", [
      {
        name: "Справочник клиентов",
        headers: ["Название клиента", "Контакт"],
        rows: clientsResult.data.map((client) => ({
          "Название клиента": client.name,
          Контакт: "",
        })),
      },
      {
        name: "Справочник водителей",
        headers: ["Водитель"],
        rows: freshDriverOptions.map((driver) => ({
          Водитель: driver.label,
        })),
        dropdownForHeader: "Водитель",
        hidden: true,
      },
    ]);
  }

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEditSites || createSite.isPending) return;
    if (!form.branch.trim() || !form.customer.trim() || !form.clientId) {
      toast({ title: "Заполните обязательные поля", description: "Выберите куст, клиента и торговое название объекта.", variant: "destructive" });
      return;
    }

    const data = {
      name: form.name,
      address: form.address,
      branch: form.branch.trim(),
      customer: form.customer.trim(),
      clientId: form.clientId,
      manager: form.manager,
      managerContact: form.managerContact,
      director: form.director,
      project: form.project,
      driverUserId: form.driverUserId || null,
      deliveryType: form.deliveryType,
      features: form.features,
    };

    createSite.mutate({ data });
  }

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col md:h-[calc(100dvh-4rem)]">
      {isAdmin && isDeliveryImportFlow && (
        <div
          className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="sites-delivery-import-hint"
        >
          <div>
            <div className="font-semibold">Добавьте отсутствующие объекты</div>
            <div>
              После добавления всех объектов вернитесь к доставкам и повторно
              выберите исходный Excel-файл.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const params = new URLSearchParams({
                resumeImport: "1",
                importMode: deliveryImportMode,
              });
              if (
                deliveryImportMonth &&
                /^\d{4}-(0[1-9]|1[0-2])$/.test(deliveryImportMonth)
              ) {
                params.set("month", deliveryImportMonth);
              }
              setLocation(`/deliveries?${params.toString()}`);
            }}
            data-testid="button-return-to-delivery-import"
          >
            Вернуться к импорту
          </Button>
        </div>
      )}
      <div
        className={cn(
          "relative z-30 shrink-0 bg-background",
          hasCompactMobileHeader
            ? "space-y-2 pb-2 md:space-y-6 md:pb-6"
            : "space-y-6 pb-6",
        )}
      >
        <h1
          className={cn(
            "block w-full rounded-md bg-[#f5ecd9] px-4 py-2 text-2xl font-bold text-blue-900",
            hasCompactMobileHeader && "text-lg md:text-2xl",
          )}
          data-testid="text-page-title"
        >
          Объекты
        </h1>
        <div
          className={cn(
            "flex items-center justify-between",
            hasCompactMobileHeader && "gap-2",
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <p
              className={cn(
                "mt-1 text-sm text-muted-foreground",
                hasCompactMobileHeader && "hidden md:block",
              )}
            >
              Справочник обслуживаемых объектов
            </p>
            <span
              className="inline-flex h-8 items-center rounded-md border bg-muted/50 px-3 text-sm text-foreground"
              data-testid="text-sites-count"
            >
              Объектов:&nbsp;
              <strong>
                {isLoading
                  ? "…"
                  : filteredSites.length.toLocaleString("ru-RU")}
              </strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isAdmin && (
              <Button
                variant="outline"
                className="border-orange-500 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                onClick={() => setMappingDialogOpen(true)}
                data-testid="button-open-legacy-mapping"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Привязка водителей ({legacyAssignments.length})
              </Button>
            )}
            {isAdmin && (
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportFile}
                data-testid="input-import-sites"
              />
            )}
            <Button
              variant="outline"
              size={hasCompactMobileHeader ? "sm" : "default"}
              className={cn(hasCompactMobileHeader && "h-8 px-2 text-xs md:h-10 md:px-4 md:text-sm")}
              onClick={handleDownloadTemplate}
              disabled={clientsLoading || clientsFetching}
              data-testid="button-download-template-sites"
            >
              <FileDown className="mr-1 h-4 w-4 md:mr-2" />
              Шаблон
            </Button>
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={
                  createSitesBulk.isPending ||
                  clientsLoading ||
                  clientsFetching
                }
                data-testid="button-import-sites"
              >
                <Upload className="h-4 w-4 mr-2" />
                Загрузить шаблон
              </Button>
            )}
            <Button
              variant="outline"
              size={hasCompactMobileHeader ? "sm" : "default"}
              className={cn(hasCompactMobileHeader && "h-8 px-2 text-xs md:h-10 md:px-4 md:text-sm")}
              onClick={handleExport}
              data-testid="button-export-sites"
            >
              <Download className="mr-1 h-4 w-4 md:mr-2" />
              <span className="md:hidden">Выгрузить</span>
              <span className="hidden md:inline">Выгрузить для редактирования</span>
            </Button>
            {canEditSites && (
              <Button onClick={openCreateDialog} data-testid="button-add-site">
                <Plus className="h-4 w-4 mr-2" />
                Добавить объект
              </Button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="rounded-md border bg-background p-4 space-y-3" data-testid="site-change-requests">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Предложения правок</h2>
              <Badge>{pendingChangeRequests.length}</Badge>
            </div>
            {pendingChangeRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ожидающих предложений нет</p>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto">
                {pendingChangeRequests.map((request) => (
                  <div key={request.id} className="rounded-md border p-3 text-sm space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong>{request.siteName}</strong>
                        <span className="text-muted-foreground">
                          {" "}— {request.authorName} ({request.authorEmail}),{" "}
                          {new Date(request.createdAt).toLocaleString("ru-RU")}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => approveChangeRequest.mutate({ id: request.id })}
                          disabled={approveChangeRequest.isPending || rejectChangeRequest.isPending}
                        >
                          Принять
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rejectChangeRequest.mutate({ id: request.id })}
                          disabled={approveChangeRequest.isPending || rejectChangeRequest.isPending}
                        >
                          Отклонить
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-1">
                      {Object.entries(request.payload).map(([field, after]) => {
                        const before = request.originalPayload[field as keyof typeof request.originalPayload];
                        const display = (value: unknown) => {
                          if (field === "clientId") {
                            return clients.find((client) => client.id === value)?.name ?? String(value ?? "Не выбран");
                          }
                          if (field === "driverUserId") {
                            const driver = drivers.find((item) => item.id === value);
                            return driver ? driver.name || driver.email : "Не назначен";
                          }
                          return String(value ?? "Не указано");
                        };
                        return (
                          <div key={field}>
                            <span className="font-medium">{CHANGE_FIELD_LABELS[field] ?? field}:</span>{" "}
                            <span className="text-red-700 line-through">{display(before)}</span>
                            {" → "}
                            <span className="text-green-700">{display(after)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div
            className={cn(
              "relative w-64",
              hasCompactMobileHeader && "min-w-0 flex-1 md:w-64 md:flex-none",
            )}
          >
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по части слова..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-sites"
            />
          </div>
          {hasCompactMobileHeader && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 px-3 md:hidden"
              onClick={() => setMobileFiltersOpen((open) => !open)}
              aria-expanded={mobileFiltersOpen}
              data-testid="button-toggle-mobile-site-filters"
            >
              <SlidersHorizontal className="mr-1.5 h-4 w-4" />
              Фильтры
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-1.5 px-1.5">
                  {Object.values(fieldFilters).filter(Boolean).length +
                    (clientIdFilter ? 1 : 0)}
                </Badge>
              )}
            </Button>
          )}
          <div
            className={cn(
              "contents",
              hasCompactMobileHeader &&
                !mobileFiltersOpen &&
                "hidden md:contents",
            )}
          >
            {FILTER_FIELDS.map(({ key, label }) => (
            <Select
              key={key}
              open={openFilter === key}
              onOpenChange={(open) => setOpenFilter(open ? key : null)}
              value={fieldFilters[key] || "__all__"}
              onValueChange={(value) =>
                setFieldFilters({
                  ...fieldFilters,
                  [key]: value === "__all__" ? "" : value,
                })
              }
            >
              <SelectTrigger
                className="h-10 w-[175px] bg-background"
                data-testid={`select-filter-${key}`}
              >
                <span className="truncate">
                  {fieldFilters[key] ? `${label}: ${fieldFilters[key]}` : label}
                </span>
              </SelectTrigger>
              {openFilter === key && (
                <SelectContent>
                  <SelectItem value="__all__">{label}: все</SelectItem>
                  {(filterOptions[key] ?? []).map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              )}
            </Select>
            ))}
            <div className="flex h-10 items-center gap-2 rounded-md border px-3">
            <Checkbox
              id="showClosed"
              checked={showClosed}
              onCheckedChange={(c) => setShowClosed(!!c)}
            />
            <Label htmlFor="showClosed" className="whitespace-nowrap">
              Показывать закрытые
            </Label>
            </div>
            {clientIdFilter && (
            <Badge variant="secondary" data-testid="filter-sites-client">
              Клиент: {filteredClientName ?? clientIdFilter}
            </Badge>
            )}
            {hasActiveFilters && (
            <Button
              variant="ghost"
              onClick={() => {
                setFieldFilters({});
                if (clientIdFilter) setLocation("/sites");
              }}
              data-testid="button-reset-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Сбросить
            </Button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border rounded-md">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-20 bg-background shadow-sm">
            <TableRow>
              <SortableHeader
                field="name"
                label="Название"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="address"
                label="Адрес"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="branch"
                label="Куст"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="customer"
                label="Торг. название"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="client"
                label="Клиент"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="manager"
                label="Менеджер"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="director"
                label="Руководитель"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="project"
                label="Проект"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="driver"
                label="Водитель"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="deliveryType"
                label="Тип поставки"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead>Особенности</TableHead>
              <SortableHeader
                field="createdAt"
                label="Добавлен"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={13}
                  className="text-center text-muted-foreground py-8"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : filteredSites.length > 0 ? (
              visibleSites.map((site) => (
                <TableRow
                  key={site.id}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/sites/${site.id}`)}
                  data-testid={`row-site-${site.id}`}
                >
                  <TableCell className="font-medium whitespace-nowrap py-1.5">
                    <div className="flex items-center gap-2">
                      {site.name}
                      {site.isClosed && (
                        <Badge variant="destructive" className="h-5 px-1 py-0 text-[10px]">
                          Закрыт
                        </Badge>
                      )}
                    </div>
                    {site.isClosed && site.closureReason && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {site.closureReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground truncate max-w-[160px] py-1.5"
                    title={site.address}
                  >
                    {site.address}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[100px] py-1.5"
                    title={site.branch}
                  >
                    {site.branch}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[110px] py-1.5"
                    title={site.customer}
                  >
                    {site.customer}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[110px] py-1.5"
                    title={site.client}
                  >
                    {site.client}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[90px] py-1.5"
                    title={site.manager}
                  >
                    {site.manager}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[90px] py-1.5"
                    title={site.director}
                  >
                    {site.director}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[110px] py-1.5"
                    title={site.project}
                  >
                    {site.project}
                  </TableCell>
                  <TableCell
                    className="max-w-[160px] py-1.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {isAdmin && editingDriverSiteId === site.id ? (
                      <Select
                        open
                        onOpenChange={(open) => {
                          if (!open) setEditingDriverSiteId(null);
                        }}
                        value={site.driverUserId ?? "__none__"}
                        onValueChange={(value) => {
                          setEditingDriverSiteId(null);
                          updateSiteDriver.mutate({
                            id: site.id,
                            data: {
                              clientId: site.clientId,
                              driverUserId:
                                value === "__none__" ? null : value,
                            },
                          });
                        }}
                        disabled={updateSiteDriver.isPending}
                      >
                        <SelectTrigger
                          className="h-8 min-w-36 text-xs"
                          data-testid={`select-site-driver-${site.id}`}
                        >
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
                    ) : isAdmin ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 max-w-full justify-start px-2 text-xs font-normal"
                        onClick={() => setEditingDriverSiteId(site.id)}
                        data-testid={`button-edit-site-driver-${site.id}`}
                        title="Изменить закреплённого водителя"
                      >
                        <span className="truncate">
                          {site.driver || "Не назначен"}
                        </span>
                        <Pencil className="ml-2 h-3 w-3 shrink-0 text-muted-foreground" />
                      </Button>
                    ) : (
                      <span className="truncate" title={site.driver}>
                        {site.driver}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[110px] py-1.5"
                    title={site.deliveryType}
                  >
                    {site.deliveryType}
                  </TableCell>
                  <TableCell
                    className="max-w-[220px] truncate py-1.5"
                    title={site.features}
                  >
                    {site.features || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap py-1.5">
                    {dateFormatter.format(new Date(site.createdAt))}
                  </TableCell>
                  <TableCell
                    className="py-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isAdmin && (
                      <div className="flex items-center justify-end gap-1">
                        {!site.isClosed ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={() => setCloseTarget(site)}
                            title="Закрыть объект"
                          >
                            <Lock className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-600"
                            onClick={() => reopenSite.mutate({ id: site.id })}
                            title="Открыть объект"
                            disabled={reopenSite.isPending}
                          >
                            <Unlock className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setLocation(`/sites/${site.id}`)}
                          data-testid={`button-edit-site-${site.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setDeleteTarget(site)}
                          data-testid={`button-delete-site-${site.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={13}
                  className="text-center text-muted-foreground py-8"
                >
                  Объекты не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {!isLoading && filteredSites.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background py-2 text-sm">
          <span className="text-muted-foreground">
            Показаны{" "}
            {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, filteredSites.length)} из{" "}
            {filteredSites.length.toLocaleString("ru-RU")}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Строк:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(1);
              }}
            >
              <SelectTrigger
                className="h-8 w-20"
                aria-label="Количество объектов на странице"
                data-testid="select-sites-page-size"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage === 1}
              aria-label="Предыдущая страница объектов"
              data-testid="button-sites-page-previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-24 text-center tabular-nums">
              {currentPage} из {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((value) => Math.min(pageCount, value + 1))
              }
              disabled={currentPage === pageCount}
              aria-label="Следующая страница объектов"
              data-testid="button-sites-page-next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={tradeNamesDialogOpen} onOpenChange={setTradeNamesDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Справочник торговых названий</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {canEditSites && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newTradeName.trim();
                  if (name) createTradeName.mutate({ data: { name } });
                }}
              >
                <Input
                  value={newTradeName}
                  onChange={(e) => setNewTradeName(e.target.value)}
                  placeholder="Новое торговое название"
                  data-testid="input-new-trade-name"
                />
                <Button
                  type="submit"
                  disabled={createTradeName.isPending || !newTradeName.trim()}
                  data-testid="button-add-trade-name"
                >
                  Добавить
                </Button>
              </form>
            )}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {(tradeNames ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Справочник пуст. Добавьте первое название.
                </p>
              ) : (
                (tradeNames ?? []).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm gap-2 border-b py-1 last:border-b-0"
                    data-testid={`row-trade-name-${t.name}`}
                  >
                    <span>{t.name}</span>
                    {canEditSites && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteTradeName.mutate({ id: t.id })}
                        disabled={deleteTradeName.isPending}
                        data-testid={`button-delete-trade-name-${t.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              «Торговое название объекта» можно указывать только из этого
              справочника — и при создании объекта, и при загрузке из Excel.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новый объект</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название (уникальное)</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="input-site-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Адрес</Label>
              <Input
                id="address"
                required
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                data-testid="input-site-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <CreatableSiteLookup
                id="site-branch"
                label="Куст"
                value={form.branch}
                options={(siteBranches ?? []).map((branch) => branch.name)}
                onChange={(branch) => setForm((current) => ({ ...current, branch }))}
                isLoading={siteBranchesLoading}
                isError={siteBranchesError}
                onRetry={() => void refetchSiteBranches()}
              />
              <div className="space-y-2">
                <Label htmlFor="client">Клиент</Label>
                <Select
                  value={form.clientId || undefined}
                  onValueChange={(clientId) => {
                    const client = clients.find((item) => item.id === clientId);
                    setForm({
                      ...form,
                      clientId,
                      client: client?.name ?? "",
                    });
                  }}
                >
                  <SelectTrigger id="client" data-testid="select-site-client">
                    <SelectValue placeholder="Выберите клиента" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <CreatableSiteLookup
                  id="site-customer"
                  label="Торговое название объекта"
                  value={form.customer}
                  options={(tradeNames ?? []).map((item) => item.name)}
                  onChange={(customer) => setForm((current) => ({ ...current, customer }))}
                  onCreate={async (name) => {
                    const created = await createTradeName.mutateAsync({ data: { name } });
                    return created.name;
                  }}
                  isLoading={tradeNamesLoading}
                  isError={tradeNamesError}
                  onRetry={() => void refetchTradeNames()}
                />
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setTradeNamesDialogOpen(true)}
                  data-testid="button-open-trade-names"
                >
                  Справочник названий…
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manager">Закреплённый менеджер</Label>
                <Input
                  id="manager"
                  value={form.manager}
                  onChange={(e) =>
                    setForm({ ...form, manager: e.target.value })
                  }
                  data-testid="input-site-manager"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="director">Закреплённый руководитель</Label>
                <Input
                  id="director"
                  required
                  value={form.director}
                  onChange={(e) =>
                    setForm({ ...form, director: e.target.value })
                  }
                  data-testid="input-site-director"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="project">Закреплённый проект</Label>
                <Input
                  id="project"
                  required
                  value={form.project}
                  onChange={(e) =>
                    setForm({ ...form, project: e.target.value })
                  }
                  data-testid="input-site-project"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driver">Закреплённый водитель</Label>
                <Select
                  value={form.driverUserId || "__none__"}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      driverUserId: value === "__none__" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger id="driver" data-testid="select-site-driver">
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
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="managerContact">Контакт менеджера</Label>
                <Input
                  id="managerContact"
                  value={form.managerContact}
                  onChange={(e) =>
                    setForm({ ...form, managerContact: e.target.value })
                  }
                  data-testid="input-site-manager-contact"
                />
              </div>
              <div className="space-y-2">
                <Label>Тип поставки</Label>
                <Select
                  value={form.deliveryType || "__none__"}
                  onValueChange={(v) =>
                    setForm({ ...form, deliveryType: v === "__none__" ? "" : v })
                  }
                >
                  <SelectTrigger data-testid="select-site-delivery-type">
                    <SelectValue placeholder="Выберите из справочника" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Не указан</SelectItem>
                    {(deliveryTypes ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="features">Особенности</Label>
              <Textarea
                id="features"
                value={form.features}
                onChange={(e) => setForm({ ...form, features: e.target.value })}
                placeholder="Особенности работы магазина или подъезда большой машины"
                data-testid="textarea-site-features"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={createSite.isPending || !form.clientId || !form.branch.trim() || !form.customer.trim()}
                data-testid="button-submit-site"
              >
                Создать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить объект?</AlertDialogTitle>
            <AlertDialogDescription>
              Объект «{deleteTarget?.name}» будет удалён без возможности
              восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteSite.mutate({ id: deleteTarget.id })
              }
              data-testid="button-confirm-delete-site"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CloseSiteDialog
        site={closeTarget}
        open={!!closeTarget}
        onOpenChange={(open) => !open && setCloseTarget(null)}
      />
      {isAdmin && (
        <LegacyDriverMappingDialog
          open={mappingDialogOpen}
          onOpenChange={setMappingDialogOpen}
        />
      )}
    </div>
  );
}
