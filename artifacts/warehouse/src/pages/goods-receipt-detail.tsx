import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGoodsReceipt,
  useUpdateGoodsReceipt,
  usePostGoodsReceipt,
  useDeleteGoodsReceipt,
  getGetGoodsReceiptQueryKey,
  getListGoodsReceiptsQueryKey,
  getListProductsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { ArrowLeft, Pencil, Printer, Trash2, CheckCircle2, X, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type EditItem = { id: string; quantity: string; removed: boolean };

export default function GoodsReceiptDetail() {
  const params = useParams<{ id: string }>();
  const receiptId = params.id!;
  const [, setLocation] = useLocation();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit, isAdmin } = usePermissions();
  const canEditReceipts = canEdit("receipts");

  const [editing, setEditing] = useState(false);
  const [editHeader, setEditHeader] = useState({ docNumber: "", docType: "", note: "" });
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [postConfirmOpen, setPostConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: receipt, isLoading } = useGetGoodsReceipt(receiptId);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getGetGoodsReceiptQueryKey(receiptId) });
    queryClient.invalidateQueries({ queryKey: getListGoodsReceiptsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }

  const updateReceipt = useUpdateGoodsReceipt({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setEditing(false);
        toast({ title: "Документ сохранён" });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  const postReceipt = usePostGoodsReceipt({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Документ проведён", description: "Редактирование больше недоступно" });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  const deleteReceipt = useDeleteGoodsReceipt({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Документ удалён", description: "Поступивший товар списан с остатков" });
        setLocation("/receipts");
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  if (isLoading || !receipt) {
    return <div className="text-muted-foreground">Загрузка...</div>;
  }

  const canEditNow = canEditReceipts && !receipt.isPosted;

  function startEditing() {
    if (!receipt) return;
    setEditHeader({
      docNumber: receipt.docNumber,
      docType: receipt.docType,
      note: receipt.note ?? "",
    });
    setEditItems(
      receipt.items.map((i) => ({ id: i.id, quantity: String(i.quantity), removed: false })),
    );
    setEditing(true);
  }

  function handleSave() {
    const remaining = editItems.filter((i) => !i.removed);
    if (remaining.length === 0) {
      toast({
        title: "Документ должен содержать хотя бы одну позицию",
        variant: "destructive",
      });
      return;
    }
    for (const item of remaining) {
      const qty = Number(item.quantity);
      if (!qty || qty <= 0) {
        toast({ title: "Количество должно быть больше нуля", variant: "destructive" });
        return;
      }
    }
    updateReceipt.mutate({
      id: receiptId,
      data: {
        docNumber: editHeader.docNumber,
        docType: editHeader.docType,
        note: editHeader.note || null,
        items: remaining.map((i) => ({ id: i.id, quantity: Number(i.quantity) })),
      },
    });
  }

  const itemsToShow = editing
    ? receipt.items.filter((i) => !editItems.find((e) => e.id === i.id)?.removed)
    : receipt.items;

  const editTotal = editing
    ? receipt.items.reduce((sum, i) => {
        const e = editItems.find((x) => x.id === i.id);
        if (!e || e.removed) return sum;
        return sum + Number(e.quantity || 0) * i.price;
      }, 0)
    : receipt.totalSum;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full" data-testid="text-page-title">
        Поступление №{receipt.docNumber}
      </h1>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Button
            variant="ghost"
            onClick={() => setLocation("/receipts")}
            data-testid="button-back-receipts"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Назад к поступлениям
          </Button>
          <div className="flex items-center gap-3 mt-2">
            {receipt.isPosted ? (
              <Badge
                variant="outline"
                className="bg-green-100 text-green-800 hover:bg-green-100"
                data-testid="badge-receipt-posted"
              >
                Проведён
              </Badge>
            ) : (
              <Badge variant="secondary" data-testid="badge-receipt-draft">
                Черновик
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {receipt.docType} · {dateFormat.format(new Date(receipt.createdAt))}
            {receipt.suppliers.length > 0 && <> · Поставщики: {receipt.suppliers.join(", ")}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setLocation(`/receipts/${receipt.id}/print`)}
            data-testid="button-print-receipt"
          >
            <Printer className="h-4 w-4 mr-2" />
            Распечатать
          </Button>
          {canEditNow && !editing && (
            <Button variant="outline" onClick={startEditing} data-testid="button-edit-receipt">
              <Pencil className="h-4 w-4 mr-2" />
              Редактировать
            </Button>
          )}
          {editing && (
            <>
              <Button
                variant="outline"
                onClick={() => setEditing(false)}
                data-testid="button-cancel-edit"
              >
                <X className="h-4 w-4 mr-2" />
                Отмена
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateReceipt.isPending}
                data-testid="button-save-receipt"
              >
                <Save className="h-4 w-4 mr-2" />
                Сохранить
              </Button>
            </>
          )}
          {canEditNow && !editing && (
            <Button
              onClick={() => setPostConfirmOpen(true)}
              disabled={postReceipt.isPending}
              data-testid="button-post-receipt"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Провести
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="destructive"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleteReceipt.isPending}
              data-testid="button-delete-receipt"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Удалить
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="grid grid-cols-3 gap-4 max-w-3xl">
          <div className="space-y-2">
            <Label htmlFor="edit-doc-number">№ документа</Label>
            <Input
              id="edit-doc-number"
              value={editHeader.docNumber}
              onChange={(e) => setEditHeader({ ...editHeader, docNumber: e.target.value })}
              data-testid="input-edit-doc-number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-doc-type">Тип документа</Label>
            <Input
              id="edit-doc-type"
              value={editHeader.docType}
              onChange={(e) => setEditHeader({ ...editHeader, docType: e.target.value })}
              data-testid="input-edit-doc-type"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-note">Примечание</Label>
            <Input
              id="edit-note"
              value={editHeader.note}
              onChange={(e) => setEditHeader({ ...editHeader, note: e.target.value })}
              data-testid="input-edit-note"
            />
          </div>
        </div>
      )}

      {!editing && receipt.note && (
        <p className="text-sm text-muted-foreground">Примечание: {receipt.note}</p>
      )}

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Товар</TableHead>
              <TableHead>Ед.</TableHead>
              <TableHead className="w-40">Количество</TableHead>
              <TableHead className="text-right">Цена</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              {editing && <TableHead className="w-16"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemsToShow.map((item) => {
              const editItem = editItems.find((e) => e.id === item.id);
              const qty = editing && editItem ? Number(editItem.quantity || 0) : item.quantity;
              return (
                <TableRow key={item.id} data-testid={`row-receipt-item-${item.id}`}>
                  <TableCell className="font-medium">{item.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{item.productUnit}</TableCell>
                  <TableCell>
                    {editing && editItem ? (
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="h-8 w-28"
                        value={editItem.quantity}
                        onChange={(e) =>
                          setEditItems((prev) =>
                            prev.map((x) =>
                              x.id === item.id ? { ...x, quantity: e.target.value } : x,
                            ),
                          )
                        }
                        data-testid={`input-item-quantity-${item.id}`}
                      />
                    ) : (
                      item.quantity
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.price.toLocaleString("ru-RU")} ₽
                  </TableCell>
                  <TableCell className="text-right">
                    {(qty * item.price).toLocaleString("ru-RU")} ₽
                  </TableCell>
                  {editing && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setEditItems((prev) =>
                            prev.map((x) => (x.id === item.id ? { ...x, removed: true } : x)),
                          )
                        }
                        data-testid={`button-remove-item-${item.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={4} className="font-semibold text-right">
                Итого:
              </TableCell>
              <TableCell className="text-right font-semibold" data-testid="text-receipt-total">
                {editTotal.toLocaleString("ru-RU")} ₽
              </TableCell>
              {editing && <TableCell />}
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={postConfirmOpen} onOpenChange={setPostConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Провести документ?</AlertDialogTitle>
            <AlertDialogDescription>
              После проведения документ станет доступен только для просмотра — редактировать его
              будет нельзя. Удалить проведённый документ сможет только администратор.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-post">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => postReceipt.mutate({ id: receiptId })}
              data-testid="button-confirm-post"
            >
              Провести
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить документ поступления?</AlertDialogTitle>
            <AlertDialogDescription>
              Документ №{receipt.docNumber} будет удалён вместе со всеми позициями, а поступивший
              по нему товар — списан с остатков. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteReceipt.mutate({ id: receiptId })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
