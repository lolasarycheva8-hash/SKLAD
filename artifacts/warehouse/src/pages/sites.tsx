import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSites,
  useCreateSite,
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
  exportRowsToExcel,
  str,
  num,
} from "@/lib/excel-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
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
import { resolveImportDriver } from "@/lib/driver-import";

type FormState = {
  name: string;
  address: string;
  branch: string;
  customer: string;
  client: string;
  manager: string;
  managerContact: string;
  director: string;
  project: string;
  driverUserId: string;
  deliveryType: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  address: "",
  branch: "",
  customer: "",
  client: "",
  manager: "",
  managerContact: "",
  director: "",
  project: "",
  driverUserId: "",
  deliveryType: "",
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
  "Email водителя",
  "Тип поставки",
];

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

export default function Sites() {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
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

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { canEdit, isAdmin } = usePermissions();
  const canEditSites = canEdit("sites");

  const { data: legacyAssignments = [] } = useGetLegacyDriverAssignments({
    query: {
      enabled: isAdmin,
      queryKey: getGetLegacyDriverAssignmentsQueryKey(),
    },
  });

  useEffect(() => {
    if (!canEditSites || !location.includes("add=1")) return;
    setForm(EMPTY_FORM);
    setDialogOpen(true);
    setLocation("/sites");
  }, [canEditSites, location, setLocation]);

  const { data: tradeNames } = useListTradeNames();
  const { data: deliveryTypes } = useListDeliveryTypes();
  const {
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

  const { data: sites, isLoading } = useListSites({
    search: search || undefined,
  });
  const { data: drivers = [] } = useListDrivers();

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
  }, [sites, fieldFilters, showClosed, sortField, sortDir]);

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

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const hasActiveFilters = Object.values(fieldFilters).some(Boolean);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
  };

  const createSite = useCreateSite({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDialogOpen(false);
        toast({ title: "Объект добавлен" });
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
      const items = rows.map((row) => {
        const driver = resolveImportDriver(
          drivers,
          str(row["Водитель"]),
          str(row["Email водителя"]),
        );
        return {
          name: str(row["Название"]),
          address: str(row["Адрес"]),
          branch: str(row["Куст"]),
          customer: str(row["Торговое название объекта"]),
          client: str(row["Клиент"]),
          manager: str(row["Менеджер"]),
          managerContact: str(row["Контакт менеджера"]),
          director: str(row["Руководитель"]),
          project: str(row["Проект"]),
          driverUserId: driver?.id ?? null,
          deliveryType: str(row["Тип поставки"]),
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
      Название: site.name,
      Адрес: site.address,
      Куст: site.branch,
      "Торговое название объекта": site.customer,
      Клиент: site.client,
      Менеджер: site.manager,
      "Контакт менеджера": site.managerContact,
      Руководитель: site.director,
      Проект: site.project,
      Водитель: site.driver,
      "Email водителя": drivers.find((driver) => driver.id === site.driverUserId)?.email ?? "",
      "Тип поставки": site.deliveryType,
    }));
    exportRowsToExcel(rows, TEMPLATE_HEADERS, "объекты.xlsx");
  }

  async function handleDownloadTemplate() {
    const result = await refetchClients();
    if (result.isError || !result.data) {
      toast({
        title: "Не удалось загрузить справочник клиентов",
        description:
          "Шаблон не скачан. Проверьте соединение и попробуйте ещё раз.",
        variant: "destructive",
      });
      return;
    }

    downloadTemplate(TEMPLATE_HEADERS, "шаблон-объекты.xlsx", [
      {
        name: "Справочник клиентов",
        headers: ["Название клиента", "Контакт"],
        rows: result.data.map((client) => ({
          "Название клиента": client.name,
          Контакт: "",
        })),
      },
      {
        name: "Справочник водителей",
        headers: ["Водитель", "Email"],
        rows: drivers.map((driver) => ({
          Водитель: driver.name || driver.email,
          Email: driver.email,
        })),
      },
    ]);
  }

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const data = {
      name: form.name,
      address: form.address,
      branch: form.branch,
      customer: form.customer,
      client: form.client,
      manager: form.manager,
      managerContact: form.managerContact,
      director: form.director,
      project: form.project,
      driverUserId: form.driverUserId || null,
      deliveryType: form.deliveryType,
    };

    createSite.mutate({ data });
  }

  return (
    <div className="flex h-[calc(100vh-2rem)] min-h-0 flex-col gap-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Объекты
      </h1>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Справочник обслуживаемых объектов
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
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
          {canEditSites && (
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
            onClick={handleDownloadTemplate}
            disabled={clientsLoading || clientsFetching}
            data-testid="button-download-template-sites"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Выгрузить шаблон
          </Button>
          {canEditSites && (
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={createSitesBulk.isPending}
              data-testid="button-import-sites"
            >
              <Upload className="h-4 w-4 mr-2" />
              Загрузить шаблон
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleExport}
            data-testid="button-export-sites"
          >
            <Download className="h-4 w-4 mr-2" />
            Выгрузить
          </Button>
          {canEditSites && (
            <Button onClick={openCreateDialog} data-testid="button-add-site">
              <Plus className="h-4 w-4 mr-2" />
              Добавить объект
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по части слова..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-sites"
          />
        </div>
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
        {hasActiveFilters && (
          <Button
            variant="ghost"
            onClick={() => setFieldFilters({})}
            data-testid="button-reset-filters"
          >
            <X className="h-4 w-4 mr-1" />
            Сбросить
          </Button>
        )}
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
                  colSpan={12}
                  className="text-center text-muted-foreground py-8"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : filteredSites.length > 0 ? (
              filteredSites.map((site) => (
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
                    className="truncate max-w-[90px] py-1.5"
                    title={site.driver}
                  >
                    {site.driver}
                  </TableCell>
                  <TableCell
                    className="truncate max-w-[110px] py-1.5"
                    title={site.deliveryType}
                  >
                    {site.deliveryType}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap py-1.5">
                    {dateFormatter.format(new Date(site.createdAt))}
                  </TableCell>
                  <TableCell
                    className="py-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEditSites && (
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
                  colSpan={12}
                  className="text-center text-muted-foreground py-8"
                >
                  Объекты не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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
              <div className="space-y-2">
                <Label htmlFor="branch">Куст</Label>
                <Input
                  id="branch"
                  required
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  data-testid="input-site-branch"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client">Клиент</Label>
                <Input
                  id="client"
                  required
                  value={form.client}
                  onChange={(e) => setForm({ ...form, client: e.target.value })}
                  data-testid="input-site-client"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Торговое название объекта (необязательно)</Label>
                <Select
                  value={form.customer || undefined}
                  onValueChange={(v) => setForm({ ...form, customer: v })}
                >
                  <SelectTrigger data-testid="select-site-customer">
                    <SelectValue placeholder="Можно не указывать" />
                  </SelectTrigger>
                  <SelectContent>
                    {(tradeNames ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  required
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
            <DialogFooter>
              <Button
                type="submit"
                disabled={createSite.isPending}
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
