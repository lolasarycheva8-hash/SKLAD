import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProducts,
  useUpdateProduct,
  useDeleteProduct,
  useListCategories,
  useCreateCategory,
  useDeleteCategory,
  useCreateProductsBulk,
  getListProductsQueryKey,
  getGetDashboardSummaryQueryKey,
  getListCategoriesQueryKey,
} from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";
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
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SortableHeader,
  type SortDirection,
} from "@/components/sortable-header";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Upload,
  Download,
  FileDown,
  Filter,
  Settings,
  X,
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

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const TEMPLATE_HEADERS = [
  "Название",
  "Артикул",
  "Ед. измерения",
  "Цена закупочная",
  "Цена продажная",
  "Категория",
  "Мин. остаток",
  "Начальный остаток",
  "Поставщик",
  "Контакт поставщика",
];

type FormState = {
  name: string;
  sku: string;
  unit: string;
  purchasePrice: string;
  price: string;
  categoryId: string;
  minStock: string;
  initialStock: string;
  supplier: string;
  supplierContact: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  sku: "",
  unit: "шт",
  purchasePrice: "",
  price: "",
  categoryId: "",
  minStock: "0",
  initialStock: "0",
  supplier: "",
  supplierContact: "",
};

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

type SortField =
  | "name"
  | "sku"
  | "category"
  | "supplier"
  | "purchasePrice"
  | "price"
  | "stock"
  | "createdAt";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default function Products() {
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { canEdit } = usePermissions();
  const canEditProducts = canEdit("products");

  useEffect(() => {
    if (getQueryParam("lowStock") === "1") {
      setLowStockOnly(true);
    }
  }, []);

  const { data: products, isLoading } = useListProducts({
    search: search || undefined,
    lowStockOnly: lowStockOnly || undefined,
  });
  const { data: categories } = useListCategories();

  const filteredProducts = useMemo(() => {
    const filtered = (products ?? []).filter((product) => {
      if (categoryFilter && product.categoryId !== categoryFilter) return false;
      if (
        supplierFilter &&
        !(product.supplier ?? "")
          .toLowerCase()
          .includes(supplierFilter.toLowerCase())
      )
        return false;
      if (
        skuFilter &&
        !product.sku.toLowerCase().includes(skuFilter.toLowerCase())
      )
        return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "name":
          return a.name.localeCompare(b.name, "ru") * dir;
        case "sku":
          return a.sku.localeCompare(b.sku, "ru") * dir;
        case "category":
          return (
            (a.categoryName ?? "").localeCompare(b.categoryName ?? "", "ru") *
            dir
          );
        case "supplier":
          return (a.supplier ?? "").localeCompare(b.supplier ?? "", "ru") * dir;
        case "purchasePrice":
          return (a.purchasePrice - b.purchasePrice) * dir;
        case "price":
          return (a.price - b.price) * dir;
        case "stock":
          return (a.currentStock - b.currentStock) * dir;
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
  }, [products, categoryFilter, supplierFilter, skuFilter, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const activeFilterCount = [categoryFilter, supplierFilter, skuFilter].filter(
    Boolean,
  ).length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetDashboardSummaryQueryKey(),
    });
  };

  const createCategory = useCreateCategory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCategoriesQueryKey(),
        });
        setNewCategoryName("");
        toast({ title: "Категория добавлена" });
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

  const deleteCategory = useDeleteCategory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCategoriesQueryKey(),
        });
        invalidate();
        setDeleteCategoryTarget(null);
        toast({ title: "Категория удалена" });
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

  const updateProduct = useUpdateProduct({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDialogOpen(false);
        toast({ title: "Товар обновлён" });
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

  const deleteProduct = useDeleteProduct({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteTarget(null);
        toast({ title: "Товар удалён" });
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

  const createProductsBulk = useCreateProductsBulk({
    mutation: {
      onSuccess: (data) => {
        invalidate();
        toast({
          title: "Импорт завершён",
          description: `Обработано товаров: ${data.length}`,
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
      const categoryByName = new Map(
        (categories ?? []).map((category) => [
          category.name.trim().toLowerCase(),
          category.id,
        ]),
      );

      const items = rows.map((row) => {
        const categoryName = str(row["Категория"]).toLowerCase();
        return {
          name: str(row["Название"]),
          sku: str(row["Артикул"]),
          unit: str(row["Ед. измерения"]) || "шт",
          purchasePrice: num(row["Цена закупочная"]),
          price: num(row["Цена продажная"]),
          categoryId: categoryName
            ? (categoryByName.get(categoryName) ?? null)
            : null,
          minStock: num(row["Мин. остаток"]),
          initialStock: num(row["Начальный остаток"]),
          supplier: str(row["Поставщик"]) || null,
          supplierContact: str(row["Контакт поставщика"]) || null,
        };
      });

      if (items.length === 0) {
        toast({ title: "Файл пуст", variant: "destructive" });
        return;
      }

      createProductsBulk.mutate({ data: { items } });
    } catch (error) {
      toast({
        title: "Не удалось прочитать файл",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }

  function handleExport() {
    const rows = (products ?? []).map((product) => ({
      Название: product.name,
      Артикул: product.sku,
      "Ед. измерения": product.unit,
      "Цена закупочная": product.purchasePrice,
      "Цена продажная": product.price,
      Категория: product.categoryName ?? "",
      "Мин. остаток": product.minStock,
      "Начальный остаток": product.currentStock,
      Поставщик: product.supplier ?? "",
      "Контакт поставщика": product.supplierContact ?? "",
    }));
    exportRowsToExcel(rows, TEMPLATE_HEADERS, "товары.xlsx");
  }

  function openEditDialog(product: Product) {
    setEditingProduct(product);
    setForm({
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      purchasePrice: String(product.purchasePrice),
      price: String(product.price),
      categoryId: product.categoryId ?? "",
      minStock: String(product.minStock),
      initialStock: "0",
      supplier: product.supplier ?? "",
      supplierContact: product.supplierContact ?? "",
    });
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!editingProduct) return;

    updateProduct.mutate({
      id: editingProduct.id,
      data: {
        name: form.name,
        sku: form.sku,
        unit: form.unit,
        purchasePrice: Number(form.purchasePrice),
        price: Number(form.price),
        categoryId: form.categoryId || null,
        minStock: Number(form.minStock),
        supplier: form.supplier || null,
        supplierContact: form.supplierContact || null,
      },
    });
  }

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Товары
      </h1>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Управление товарами и остатками на складе
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {canEditProducts && (
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImportFile}
              data-testid="input-import-products"
            />
          )}
          <Button
            variant="outline"
            onClick={() =>
              downloadTemplate(TEMPLATE_HEADERS, "шаблон-товары.xlsx")
            }
            data-testid="button-download-template-products"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Выгрузить шаблон
          </Button>
          {canEditProducts && (
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={createProductsBulk.isPending}
              data-testid="button-import-products"
            >
              <Upload className="h-4 w-4 mr-2" />
              Загрузить шаблон
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleExport}
            data-testid="button-export-products"
          >
            <Download className="h-4 w-4 mr-2" />
            Выгрузить
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-products"
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={lowStockOnly}
            onCheckedChange={(checked) => setLowStockOnly(checked === true)}
            data-testid="checkbox-low-stock-only"
          />
          Только с низким остатком
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" data-testid="button-open-filters">
              <Filter className="h-4 w-4 mr-2" />
              Фильтры
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-3" align="start">
            <div className="space-y-2">
              <Label>Категория</Label>
              <Select
                value={categoryFilter || "all"}
                onValueChange={(value) =>
                  setCategoryFilter(value === "all" ? "" : value)
                }
              >
                <SelectTrigger data-testid="select-filter-category">
                  <SelectValue placeholder="Все категории" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все категории</SelectItem>
                  {categories?.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Поставщик</Label>
              <Input
                placeholder="Фильтр по поставщику..."
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                data-testid="input-filter-supplier"
              />
            </div>
            <div className="space-y-2">
              <Label>Артикул</Label>
              <Input
                placeholder="Фильтр по артикулу..."
                value={skuFilter}
                onChange={(e) => setSkuFilter(e.target.value)}
                data-testid="input-filter-sku"
              />
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setCategoryFilter("");
                  setSupplierFilter("");
                  setSkuFilter("");
                }}
                data-testid="button-reset-filters"
              >
                <X className="h-4 w-4 mr-1" />
                Сбросить фильтры
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                field="name"
                label="Название"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="sku"
                label="Артикул"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead>Ед. измерения</TableHead>
              <SortableHeader
                field="category"
                label="Категория"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="purchasePrice"
                label="Цена закупочная, ₽"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className="text-right"
                align="right"
              />
              <SortableHeader
                field="price"
                label="Цена продажная, ₽"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className="text-right"
                align="right"
              />
              <SortableHeader
                field="stock"
                label="Остаток на складе"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className="text-right"
                align="right"
              />
              <TableHead className="text-right">Мин. остаток</TableHead>
              <SortableHeader
                field="supplier"
                label="Поставщик"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead>Контакты поставщика</TableHead>
              <SortableHeader
                field="createdAt"
                label="Добавлен"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead className="w-24"></TableHead>
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
            ) : filteredProducts.length > 0 ? (
              filteredProducts.map((product) => {
                const isNegative = product.currentStock < 0;
                const negativeCellClass = isNegative
                  ? "text-red-600 font-medium"
                  : "";
                return (
                  <TableRow
                    key={product.id}
                    data-testid={`row-product-${product.id}`}
                  >
                    <TableCell className={`font-medium ${negativeCellClass}`}>
                      {product.name}
                    </TableCell>
                    <TableCell
                      className={negativeCellClass || "text-muted-foreground"}
                    >
                      {product.sku}
                    </TableCell>
                    <TableCell
                      className={negativeCellClass || "text-muted-foreground"}
                    >
                      {product.unit}
                    </TableCell>
                    <TableCell
                      className={negativeCellClass || "text-muted-foreground"}
                    >
                      {product.categoryName ?? "—"}
                    </TableCell>
                    <TableCell className={`text-right ${negativeCellClass}`}>
                      {currency.format(product.purchasePrice)}
                    </TableCell>
                    <TableCell className={`text-right ${negativeCellClass}`}>
                      {currency.format(product.price)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isNegative ? (
                        <Badge
                          className="bg-red-100 text-red-800 hover:bg-red-100"
                          variant="outline"
                        >
                          {product.currentStock} {product.unit}
                        </Badge>
                      ) : product.minStock > 0 &&
                        product.currentStock <= product.minStock * 0.6 ? (
                        <Badge
                          className="bg-red-100 text-red-800 hover:bg-red-100"
                          variant="outline"
                        >
                          {product.currentStock} {product.unit}
                        </Badge>
                      ) : product.minStock > 0 &&
                        product.currentStock >= product.minStock * 1.5 ? (
                        <Badge
                          className="bg-green-100 text-green-800 hover:bg-green-100"
                          variant="outline"
                        >
                          {product.currentStock} {product.unit}
                        </Badge>
                      ) : (
                        <span className="text-sm">
                          {product.currentStock} {product.unit}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right ${negativeCellClass || "text-muted-foreground"}`}
                    >
                      {product.minStock} {product.unit}
                    </TableCell>
                    <TableCell
                      className={negativeCellClass || "text-muted-foreground"}
                    >
                      {product.supplier || "—"}
                    </TableCell>
                    <TableCell
                      className={negativeCellClass || "text-muted-foreground"}
                    >
                      {product.supplierContact || "—"}
                    </TableCell>
                    <TableCell
                      className={negativeCellClass || "text-muted-foreground"}
                    >
                      {dateFormatter.format(new Date(product.createdAt))}
                    </TableCell>
                    <TableCell>
                      {canEditProducts && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(product)}
                            data-testid={`button-edit-${product.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(product)}
                            data-testid={`button-delete-${product.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={12}
                  className="text-center text-muted-foreground py-8"
                >
                  Товары не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать товар</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="input-product-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sku">Артикул</Label>
                <Input
                  id="sku"
                  required
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  data-testid="input-product-sku"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Ед. измерения</Label>
                <Input
                  id="unit"
                  required
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  data-testid="input-product-unit"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Категория</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={form.categoryId || "none"}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      categoryId: value === "none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger data-testid="select-product-category">
                    <SelectValue placeholder="Без категории" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без категории</SelectItem>
                    {categories?.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canEditProducts && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        data-testid="button-manage-categories"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="end">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">
                          Управление категориями
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Новая категория"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            data-testid="input-new-category"
                          />
                          <Button
                            type="button"
                            size="icon"
                            disabled={
                              !newCategoryName.trim() ||
                              createCategory.isPending
                            }
                            onClick={() =>
                              createCategory.mutate({
                                data: { name: newCategoryName.trim() },
                              })
                            }
                            data-testid="button-create-category"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-auto">
                          {categories?.length ? (
                            categories.map((category) => (
                              <div
                                key={category.id}
                                className="flex items-center justify-between text-sm py-1"
                                data-testid={`category-row-${category.id}`}
                              >
                                <span>{category.name}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() =>
                                    setDeleteCategoryTarget({
                                      id: category.id,
                                      name: category.name,
                                    })
                                  }
                                  data-testid={`button-delete-category-${category.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Категорий пока нет
                            </p>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="purchasePrice">Цена закупочная, ₽</Label>
                <Input
                  id="purchasePrice"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.purchasePrice}
                  onChange={(e) =>
                    setForm({ ...form, purchasePrice: e.target.value })
                  }
                  data-testid="input-product-purchase-price"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Цена продажная, ₽</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  data-testid="input-product-price"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minStock">Допустимый мин. остаток</Label>
                <Input
                  id="minStock"
                  type="number"
                  min="0"
                  value={form.minStock}
                  onChange={(e) =>
                    setForm({ ...form, minStock: e.target.value })
                  }
                  data-testid="input-product-min-stock"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier">Поставщик</Label>
                <Input
                  id="supplier"
                  value={form.supplier}
                  onChange={(e) =>
                    setForm({ ...form, supplier: e.target.value })
                  }
                  data-testid="input-product-supplier"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplierContact">Контакты поставщика</Label>
                <Input
                  id="supplierContact"
                  placeholder="Телефон, почта, ФИО"
                  value={form.supplierContact}
                  onChange={(e) =>
                    setForm({ ...form, supplierContact: e.target.value })
                  }
                  data-testid="input-product-supplier-contact"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={updateProduct.isPending}
                data-testid="button-submit-product"
              >
                Сохранить
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
            <AlertDialogTitle>Удалить товар?</AlertDialogTitle>
            <AlertDialogDescription>
              Товар «{deleteTarget?.name}» будет удалён без возможности
              восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteProduct.mutate({ id: deleteTarget.id })
              }
              data-testid="button-confirm-delete"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteCategoryTarget}
        onOpenChange={(open) => !open && setDeleteCategoryTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить категорию?</AlertDialogTitle>
            <AlertDialogDescription>
              Категория «{deleteCategoryTarget?.name}» будет удалена. Товары
              останутся без категории.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteCategoryTarget &&
                deleteCategory.mutate({ id: deleteCategoryTarget.id })
              }
              data-testid="button-confirm-delete-category"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
