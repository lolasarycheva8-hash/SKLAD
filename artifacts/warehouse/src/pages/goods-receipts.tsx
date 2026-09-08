import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGoodsReceipts,
  useCreateGoodsReceipt,
  useListReceiptProductLookup,
  useListReceiptCategoryLookup,
  getListGoodsReceiptsQueryKey,
  getListReceiptProductLookupQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import type { GoodsReceiptItemInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, PackagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  SortableHeader,
  type SortDirection,
} from "@/components/sortable-header";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const NEW_PRODUCT_VALUE = "__new__";

type ItemFormState = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  categoryId: string;
  purchasePrice: string;
  price: string;
  minStock: string;
  supplier: string;
  supplierContact: string;
  quantity: string;
};

const EMPTY_ITEM: ItemFormState = {
  productId: "",
  name: "",
  sku: "",
  unit: "шт",
  categoryId: "",
  purchasePrice: "",
  price: "",
  minStock: "",
  supplier: "",
  supplierContact: "",
  quantity: "",
};

type HeaderFormState = {
  docNumber: string;
  docType: string;
  note: string;
};

const EMPTY_HEADER: HeaderFormState = {
  docNumber: "",
  docType: "",
  note: "",
};

function isItemComplete(item: ItemFormState): boolean {
  return !!item.name && !!item.unit && !!item.price && !!item.quantity;
}

function isItemEmpty(item: ItemFormState): boolean {
  return (
    !item.productId &&
    !item.name &&
    !item.sku &&
    !item.categoryId &&
    !item.purchasePrice &&
    !item.price &&
    !item.minStock &&
    !item.supplier &&
    !item.supplierContact &&
    !item.quantity
  );
}

type SortField =
  | "docNumber"
  | "docType"
  | "totalSum"
  | "itemsCount"
  | "supplier"
  | "note"
  | "status"
  | "createdAt";

const ALL_SUPPLIERS = "__all__";

export default function GoodsReceipts() {
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState<string>(ALL_SUPPLIERS);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [header, setHeader] = useState<HeaderFormState>(EMPTY_HEADER);
  const [addedItems, setAddedItems] = useState<ItemFormState[]>([]);
  const [current, setCurrent] = useState<ItemFormState>({ ...EMPTY_ITEM });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditReceipts = canEdit("receipts");

  const { data: receipts, isLoading } = useListGoodsReceipts();
  const { data: products } = useListReceiptProductLookup();
  const { data: categories } = useListReceiptCategoryLookup();

  const productById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  );

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of receipts ?? []) {
      for (const s of r.suppliers) set.add(s);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [receipts]);

  function handleSort(field: string) {
    const f = field as SortField;
    if (sortField === f) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(f);
      setSortDir("asc");
    }
  }

  const visibleReceipts = useMemo(() => {
    const filtered = (receipts ?? []).filter(
      (r) =>
        supplierFilter === ALL_SUPPLIERS ||
        r.suppliers.includes(supplierFilter),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "docNumber":
          return (
            a.docNumber.localeCompare(b.docNumber, "ru", { numeric: true }) *
            dir
          );
        case "docType":
          return a.docType.localeCompare(b.docType, "ru") * dir;
        case "totalSum":
          return (a.totalSum - b.totalSum) * dir;
        case "itemsCount":
          return (a.items.length - b.items.length) * dir;
        case "supplier":
          return (
            (a.suppliers[0] ?? "").localeCompare(b.suppliers[0] ?? "", "ru") *
            dir
          );
        case "note":
          return (a.note ?? "").localeCompare(b.note ?? "", "ru") * dir;
        case "status":
          return (Number(a.isPosted) - Number(b.isPosted)) * dir;
        case "createdAt":
        default:
          return (
            (new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()) *
            dir
          );
      }
    });
  }, [receipts, supplierFilter, sortField, sortDir]);

  const calculatedTotal = useMemo(
    () =>
      [...addedItems, current].reduce((sum, item) => {
        const price = Number(item.price);
        const quantity = Number(item.quantity);
        if (!price || !quantity) return sum;
        return sum + price * quantity;
      }, 0),
    [addedItems, current],
  );

  const createReceipt = useCreateGoodsReceipt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListGoodsReceiptsQueryKey(),
        });
        queryClient.invalidateQueries({ queryKey: getListReceiptProductLookupQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetDashboardSummaryQueryKey(),
        });
        setDialogOpen(false);
        setHeader(EMPTY_HEADER);
        setAddedItems([]);
        setCurrent({ ...EMPTY_ITEM });
        toast({ title: "Поступление оформлено" });
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

  function updateCurrent(patch: Partial<ItemFormState>) {
    setCurrent((prev) => ({ ...prev, ...patch }));
  }

  function handleProductSelect(value: string) {
    if (value === NEW_PRODUCT_VALUE) {
      setCurrent({ ...EMPTY_ITEM });
      return;
    }
    const product = productById.get(value);
    if (!product) return;
    setCurrent({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      categoryId: product.categoryId ?? "",
      purchasePrice: String(product.purchasePrice ?? ""),
      price: String(product.price ?? ""),
      minStock: String(product.minStock ?? ""),
      supplier: product.supplier ?? "",
      supplierContact: product.supplierContact ?? "",
      quantity: "",
    });
  }

  function addCurrentToList() {
    if (!isItemComplete(current)) {
      toast({
        title: "Заполните позицию",
        description: "Нужны название, ед. измерения, цена и количество",
        variant: "destructive",
      });
      return;
    }
    setAddedItems((prev) => [...prev, current]);
    setCurrent({ ...EMPTY_ITEM });
  }

  function removeAddedItem(index: number) {
    setAddedItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!header.docNumber || !header.docType) return;

    let allItems = addedItems;
    if (!isItemEmpty(current)) {
      if (!isItemComplete(current)) {
        toast({
          title: "Позиция заполнена не полностью",
          description: "Дозаполните её или очистите поля",
          variant: "destructive",
        });
        return;
      }
      allItems = [...addedItems, current];
    }

    if (allItems.length === 0) {
      toast({ title: "Добавьте хотя бы одну позицию", variant: "destructive" });
      return;
    }

    const payloadItems: GoodsReceiptItemInput[] = allItems.map((item) => ({
      productId: item.productId || undefined,
      name: item.name,
      sku: item.sku || undefined,
      unit: item.unit,
      purchasePrice: item.purchasePrice
        ? Number(item.purchasePrice)
        : undefined,
      price: Number(item.price),
      categoryId: item.categoryId || undefined,
      minStock: item.minStock ? Number(item.minStock) : undefined,
      supplier: item.supplier || undefined,
      supplierContact: item.supplierContact || undefined,
      quantity: Number(item.quantity),
    }));

    createReceipt.mutate({
      data: {
        docNumber: header.docNumber,
        docType: header.docType,
        totalSum: calculatedTotal,
        note: header.note || undefined,
        items: payloadItems,
      },
    });
  }

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Поступление товара
      </h1>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Документы поступления товара от поставщиков
          </p>
        </div>
        {canEditReceipts && (
          <Button
            onClick={() => {
              setHeader(EMPTY_HEADER);
              setAddedItems([]);
              setCurrent({ ...EMPTY_ITEM });
              setDialogOpen(true);
            }}
            data-testid="button-add-receipt"
          >
            <PackagePlus className="h-4 w-4 mr-2" />
            Новое поступление
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-64" data-testid="select-supplier-filter">
            <SelectValue placeholder="Все поставщики" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SUPPLIERS}>Все поставщики</SelectItem>
            {supplierOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                field="docNumber"
                label="№ документа"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="docType"
                label="Тип документа"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="supplier"
                label="Поставщик"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="totalSum"
                label="Сумма"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="itemsCount"
                label="Позиций"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="note"
                label="Примечание"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="status"
                label="Статус"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                field="createdAt"
                label="Дата"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : visibleReceipts.length > 0 ? (
              visibleReceipts.map((receipt) => (
                <TableRow
                  key={receipt.id}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/receipts/${receipt.id}`)}
                  data-testid={`row-receipt-${receipt.id}`}
                >
                  <TableCell className="font-medium">
                    {receipt.docNumber}
                  </TableCell>
                  <TableCell>{receipt.docType}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {receipt.suppliers.length > 0
                      ? receipt.suppliers.join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {receipt.totalSum.toLocaleString("ru-RU")} ₽
                  </TableCell>
                  <TableCell>{receipt.items.length}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {receipt.note ?? "—"}
                  </TableCell>
                  <TableCell>
                    {receipt.isPosted ? (
                      <Badge
                        variant="outline"
                        className="bg-green-100 text-green-800 hover:bg-green-100"
                        data-testid={`badge-posted-${receipt.id}`}
                      >
                        Проведён
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        data-testid={`badge-draft-${receipt.id}`}
                      >
                        Черновик
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {dateFormat.format(new Date(receipt.createdAt))}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  Поступлений не найдено
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новое поступление товара</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="doc-number">№ документа</Label>
                <Input
                  id="doc-number"
                  required
                  value={header.docNumber}
                  onChange={(e) =>
                    setHeader({ ...header, docNumber: e.target.value })
                  }
                  data-testid="input-receipt-doc-number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-type">Тип документа</Label>
                <Input
                  id="doc-type"
                  required
                  placeholder="Накладная, УПД..."
                  value={header.docType}
                  onChange={(e) =>
                    setHeader({ ...header, docType: e.target.value })
                  }
                  data-testid="input-receipt-doc-type"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total-sum">Сумма документа</Label>
                <Input
                  id="total-sum"
                  readOnly
                  disabled
                  value={`${calculatedTotal.toLocaleString("ru-RU")} ₽`}
                  className="font-medium"
                  data-testid="input-receipt-total-sum"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="receipt-note">Примечание</Label>
              <Input
                id="receipt-note"
                value={header.note}
                onChange={(e) => setHeader({ ...header, note: e.target.value })}
                data-testid="input-receipt-note"
              />
            </div>

            <div className="space-y-3">
              <Label>Позиции</Label>

              {addedItems.length > 0 && (
                <div
                  className="border rounded-md divide-y"
                  data-testid="list-added-items"
                >
                  {addedItems.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      data-testid={`added-item-${index}`}
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{item.name}</span>{" "}
                        <span className="text-muted-foreground">
                          — {item.quantity} {item.unit} ×{" "}
                          {Number(item.price).toLocaleString("ru-RU")} ₽ ={" "}
                          {(
                            Number(item.quantity) * Number(item.price)
                          ).toLocaleString("ru-RU")}{" "}
                          ₽
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => removeAddedItem(index)}
                        data-testid={`button-remove-added-item-${index}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const selectedExisting = current.productId
                  ? productById.get(current.productId)
                  : undefined;
                const priceChanged =
                  !!selectedExisting &&
                  current.price !== "" &&
                  Number(current.price) !== selectedExisting.price;

                return (
                  <div
                    className="border rounded-md p-3 space-y-3"
                    data-testid="item-form"
                  >
                    <div className="space-y-2">
                      <Label>Товар</Label>
                      <Select
                        value={current.productId || NEW_PRODUCT_VALUE}
                        onValueChange={handleProductSelect}
                      >
                        <SelectTrigger data-testid="select-item-product">
                          <SelectValue placeholder="Выберите товар" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NEW_PRODUCT_VALUE}>
                            + Новый товар
                          </SelectItem>
                          {products?.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.name} — {product.price} ₽ (
                              {product.currentStock} {product.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Название</Label>
                        <Input
                          value={current.name}
                          onChange={(e) =>
                            updateCurrent({ name: e.target.value })
                          }
                          data-testid="input-item-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Артикул</Label>
                        <Input
                          placeholder="Автоматически, если не указан"
                          value={current.sku}
                          onChange={(e) =>
                            updateCurrent({ sku: e.target.value })
                          }
                          data-testid="input-item-sku"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Ед. измерения</Label>
                        <Input
                          value={current.unit}
                          onChange={(e) =>
                            updateCurrent({ unit: e.target.value })
                          }
                          data-testid="input-item-unit"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Категория</Label>
                        <Select
                          value={current.categoryId || "none"}
                          onValueChange={(value) =>
                            updateCurrent({
                              categoryId: value === "none" ? "" : value,
                            })
                          }
                        >
                          <SelectTrigger data-testid="select-item-category">
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
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>Цена закупочная</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={current.purchasePrice}
                          onChange={(e) =>
                            updateCurrent({ purchasePrice: e.target.value })
                          }
                          data-testid="input-item-purchase-price"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Цена продажная</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={current.price}
                          onChange={(e) =>
                            updateCurrent({ price: e.target.value })
                          }
                          data-testid="input-item-price"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Количество</Label>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={current.quantity}
                          onChange={(e) =>
                            updateCurrent({ quantity: e.target.value })
                          }
                          data-testid="input-item-quantity"
                        />
                      </div>
                    </div>

                    {priceChanged && (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-300 rounded-md px-3 py-2">
                        Цена отличается от текущей ({selectedExisting?.price} ₽)
                        — будет создана новая карточка товара «{current.name}» с
                        новой ценой, старая партия останется без изменений.
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Мин. остаток</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={current.minStock}
                          onChange={(e) =>
                            updateCurrent({ minStock: e.target.value })
                          }
                          data-testid="input-item-min-stock"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Поставщик</Label>
                        <Input
                          value={current.supplier}
                          onChange={(e) =>
                            updateCurrent({ supplier: e.target.value })
                          }
                          data-testid="input-item-supplier"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addCurrentToList}
                        data-testid="button-add-item"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Добавить позицию
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={createReceipt.isPending}
                data-testid="button-submit-receipt"
              >
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
