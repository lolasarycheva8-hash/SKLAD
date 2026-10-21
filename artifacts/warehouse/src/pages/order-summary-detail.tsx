import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrderSummary,
  usePayOrderSummary,
  getGetOrderSummaryQueryKey,
  getListOrderSummariesQueryKey,
  getListOrdersQueryKey,
  getGetOrderQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Printer, Download, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { SELLER_NAME, SUMMARY_STATUS_LABELS, apiErrorMessage, formatPeriod } from "@/lib/order-status";
import { downloadOrderSummaryWorkbook } from "@/lib/order-summary-export";

const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function OrderSummaryDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditOrders = canEdit("orders");
  const { data: summary, isLoading, isError, error, refetch } = useGetOrderSummary(id!);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pay = usePayOrderSummary({
    mutation: {
      onSuccess: (updated) => {
        queryClient.invalidateQueries({ queryKey: getGetOrderSummaryQueryKey(id!) });
        queryClient.invalidateQueries({ queryKey: getListOrderSummariesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        for (const o of (updated?.orders ?? summary?.orders ?? [])) {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(o.id) });
        }
        setConfirmOpen(false);
        toast({ title: "Итоговый заказ отмечен как оплаченный" });
      },
      onError: (e) => {
        setConfirmOpen(false);
        toast({ title: "Не удалось отметить оплату", description: apiErrorMessage(e), variant: "destructive" });
      },
    },
  });

  if (isLoading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>;
  }
  if (isError || !summary) {
    return (
      <div className="space-y-3">
        <div className="text-destructive">Не удалось загрузить итоговый заказ: {apiErrorMessage(error)}</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>Повторить</Button>
          <Link href="/order-summaries"><Button variant="ghost">К списку</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full" data-testid="text-page-title">
        Итоговый заказ №{summary.number}: {summary.clientName}
      </h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/order-summaries">
            <Button variant="ghost" size="icon" data-testid="button-back-to-summaries"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <Badge variant="outline" className={summary.status === "paid" ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"} data-testid="summary-status">
            {SUMMARY_STATUS_LABELS[summary.status]}
          </Badge>
          {summary.paidAt && <span className="text-sm text-muted-foreground">Оплачен {dateFormatter.format(new Date(summary.paidAt))}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/order-summaries/${summary.id}/print`}>
            <Button variant="outline" data-testid="button-print-summary"><Printer className="h-4 w-4 mr-2" />Печать</Button>
          </Link>
          <Button variant="outline" onClick={() => downloadOrderSummaryWorkbook(summary)} data-testid="button-excel-summary">
            <Download className="h-4 w-4 mr-2" />Скачать Excel
          </Button>
          {canEditOrders && summary.status === "awaiting_payment" && (
            <Button onClick={() => setConfirmOpen(true)} disabled={pay.isPending} data-testid="button-pay-summary">
              <Check className="h-4 w-4 mr-2" />Оплачен
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 rounded-md border p-4 text-sm">
        <div><div className="text-muted-foreground">Поставщик</div><div className="font-medium">{SELLER_NAME}</div></div>
        <div><div className="text-muted-foreground">Клиент</div><div className="font-medium">{summary.clientName}</div></div>
        <div><div className="text-muted-foreground">Период (месяц плана)</div><div className="font-medium">{formatPeriod(summary.periodFrom, summary.periodTo)}</div></div>
        <div><div className="text-muted-foreground">Сформирован</div><div className="font-medium">{dateFormatter.format(new Date(summary.createdAt))}</div></div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Заказы в составе ({summary.orders.length})</h2>
        <div className="flex flex-wrap gap-2">
          {summary.orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="rounded-md border px-2 py-1 text-sm hover:bg-muted" data-testid={`link-summary-order-${o.id}`}>
              №{o.number}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Позиции</h2>
        <div className="border rounded-md overflow-x-auto">
          <Table className="text-xs">
            <TableHeader><TableRow>
              <TableHead>Товар</TableHead><TableHead>Ед.</TableHead>
              <TableHead className="text-right">Количество</TableHead><TableHead className="text-right">Цена</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {summary.items.map((it) => (
                <TableRow key={`${it.productId}-${it.price}`}>
                  <TableCell className="py-1.5 font-medium">{it.productName}</TableCell>
                  <TableCell className="py-1.5">{it.unit}</TableCell>
                  <TableCell className="py-1.5 text-right">{it.quantity}</TableCell>
                  <TableCell className="py-1.5 text-right">{currency.format(it.price)}</TableCell>
                  <TableCell className="py-1.5 text-right">{currency.format(it.total)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4} className="py-1.5 text-right font-medium">Итого</TableCell>
                <TableCell className="py-1.5 text-right font-medium" data-testid="summary-total">{currency.format(summary.totalAmount)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отметить итоговый заказ как оплаченный?</AlertDialogTitle>
            <AlertDialogDescription>
              Итоговый заказ №{summary.number} на сумму {currency.format(summary.totalAmount)} и все {summary.orders.length} заказов в его составе получат статус «Оплачен». Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); pay.mutate({ id: summary.id }); }} disabled={pay.isPending} data-testid="button-confirm-pay-summary">
              {pay.isPending ? "Сохранение..." : "Оплачен"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
