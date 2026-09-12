import React, { useState } from "react";
import { Link } from "wouter";
import { MessageSquareText, FileText, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { getMonthDateBounds, toDateInputValue, confirmPlannedDate } from "@/lib/delivery-workspace";
import type { JoinedDelivery } from "@/pages/deliveries";
import { cn } from "@/lib/utils";

const mobileDateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});

export function MobileActualDateDialog({
  delivery,
  month,
  open,
  onOpenChange,
  onSave
}: {
  delivery: JoinedDelivery;
  month: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (date: string) => Promise<void>;
}) {
  const [draftDate, setDraftDate] = useState<string>("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { min, max } = getMonthDateBounds(month);

  React.useEffect(() => {
    if (open) {
      setDraftDate(delivery.actualDate ? toDateInputValue(delivery.actualDate) : "");
      setError(null);
    }
  }, [open, delivery.actualDate]);

  const handleSave = async () => {
    if (isPending || !delivery.plannedDate || !draftDate || draftDate < min || draftDate > max) return;
    try {
      setIsPending(true);
      setError(null);
      await onSave(draftDate);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Ошибка при сохранении даты");
    } finally {
      setIsPending(false);
    }
  };

  const handleClear = async () => {
    if (isPending) return;
    try {
      setIsPending(true);
      setError(null);
      await onSave("");
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Ошибка при очистке даты");
    } finally {
      setIsPending(false);
    }
  };

  const isValidDate = draftDate && draftDate >= min && draftDate <= max;
  const canSave = isValidDate && !isPending;

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent className="w-[calc(100vw_-_2rem)] max-w-md min-w-0 max-h-[90dvh] overflow-y-auto rounded-lg" aria-describedby="dialog-description">
        <DialogHeader>
          <DialogTitle>Фактическая дата доставки</DialogTitle>
          <DialogDescription id="dialog-description">
            Объект: {delivery.siteName}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          {error && (
            <div role="alert" className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Дата</span>
            <input
              type="date"
              min={min}
              max={max}
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              disabled={isPending}
              data-testid={`mobile-dialog-input-actual-date-${delivery.id}`}
              className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          
          {!delivery.actualDate && delivery.plannedDate && (
             <Button 
               type="button" 
               variant="secondary" 
               className="w-full justify-start h-12 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
               onClick={() => setDraftDate(confirmPlannedDate(delivery.plannedDate as string))}
               data-testid={`mobile-dialog-button-confirm-plan-${delivery.id}`}
             >
                Подтвердить плановую ({mobileDateFormat.format(new Date(delivery.plannedDate))})
             </Button>
          )}

          {delivery.actualDate && (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start h-12 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleClear}
              disabled={isPending}
              data-testid={`mobile-dialog-button-clear-${delivery.id}`}
            >
              Очистить фактическую дату
            </Button>
          )}
        </div>
        
        <DialogFooter className="flex flex-row gap-2 sm:justify-end mt-4">
          <Button type="button" variant="outline" className="flex-1 h-12 sm:flex-none" onClick={() => onOpenChange(false)} disabled={isPending}>
            Отмена
          </Button>
          <Button type="button" className="flex-1 h-12 sm:flex-none" onClick={handleSave} disabled={!canSave} data-testid={`mobile-dialog-button-save-${delivery.id}`}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MobileLogisticianCard({
  delivery,
  month,
  onUpdateActualDate,
  onOpenPhotos,
  onOpenDriverComment,
}: {
  delivery: JoinedDelivery;
  month: string;
  onUpdateActualDate: (id: string, date: string) => Promise<void>;
  onOpenPhotos: (delivery: JoinedDelivery) => void;
  onOpenDriverComment: (delivery: JoinedDelivery) => void;
}) {
  const [dateDialogOpen, setDateDialogOpen] = useState(false);

  const hasPhotos = delivery.photosCount > 0;
  const isDone = Boolean(delivery.actualDate);
  const isClosed = delivery.workflowStatus === "closed";
  const hasPlan = Boolean(delivery.plannedDate);

  const renderStatus = () => {
    if (isClosed) return <span className="text-emerald-600 font-medium text-xs flex items-center"><CheckCircle2 className="h-3 w-3 mr-1"/>Закрыта</span>;
    if (isDone) return <span className="text-orange-600 font-medium text-xs">Выполнена</span>;
    return <span className="text-slate-600 font-medium text-xs">В плане</span>;
  };

  return (
    <div className="bg-card text-card-foreground border rounded-lg shadow-sm mb-3 overflow-hidden flex flex-col" data-testid={`mobile-card-delivery-${delivery.id}`}>
      <div className="p-3 border-b pb-2">
        <div className="flex justify-between items-start mb-1">
          <Link href={`/sites/${delivery.siteId}`} className="font-semibold text-primary text-base line-clamp-2 leading-tight flex-1 mr-2">
            {delivery.siteName}
          </Link>
          <div className="shrink-0 text-right">
            {renderStatus()}
          </div>
        </div>
        
        <div className="text-sm text-muted-foreground mt-1 mb-2 flex items-center justify-between">
          <span className="truncate mr-2">{delivery.driver || "Водитель не назначен"}</span>
          {delivery.note && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-primary shrink-0"
              onClick={() => onOpenDriverComment(delivery)}
              aria-label={`Комментарий водителя: ${delivery.siteName}`}
              data-testid={`mobile-card-button-comment-${delivery.id}`}
            >
              <MessageSquareText className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex text-xs bg-muted/40 rounded p-1.5 justify-between">
          <div className="flex flex-col">
            <span className="text-muted-foreground">План</span>
            <span className="font-medium">{delivery.plannedDate ? mobileDateFormat.format(new Date(delivery.plannedDate)) : "—"}</span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-muted-foreground">Факт</span>
            <span className={cn("font-medium", delivery.actualDate ? "text-primary" : "")}>
              {delivery.actualDate ? mobileDateFormat.format(new Date(delivery.actualDate)) : "—"}
            </span>
          </div>
        </div>
      </div>
      
      <div className="p-2 grid grid-cols-2 gap-2 bg-muted/10">
        <Button
          type="button"
          variant={delivery.actualDate ? "outline" : "default"}
          className={cn("h-11 w-full text-sm font-medium", !delivery.actualDate && "bg-primary text-primary-foreground")}
          onClick={() => setDateDialogOpen(true)}
          disabled={!hasPlan}
          data-testid={`mobile-card-button-fact-${delivery.id}`}
        >
          {delivery.actualDate ? "Изменить факт" : "Проставить факт"}
        </Button>
        <Button
          type="button"
          variant={hasPhotos ? "outline" : "secondary"}
          className="h-11 w-full text-sm font-medium relative"
          onClick={() => onOpenPhotos(delivery)}
          disabled={!delivery.actualDate}
          data-testid={`mobile-card-button-acts-${delivery.id}`}
        >
          <FileText className={cn("h-4 w-4 mr-2", hasPhotos ? "text-emerald-600" : "text-muted-foreground")} />
          {hasPhotos ? `Акты (${delivery.photosCount})` : "Загрузить акт"}
        </Button>
      </div>

      <MobileActualDateDialog
        delivery={delivery}
        month={month}
        open={dateDialogOpen}
        onOpenChange={setDateDialogOpen}
        onSave={(date) => onUpdateActualDate(delivery.id, date)}
      />
    </div>
  );
}

export function MobileManagerTable({
  data,
  sitesWithoutDeliveries,
  canEditCorrectedPlan,
  setDriverCommentTarget,
  mobileDateFormat,
  CorrectedPlanDateCell
}: {
  data: JoinedDelivery[];
  sitesWithoutDeliveries: any[];
  canEditCorrectedPlan: boolean;
  setDriverCommentTarget: (d: JoinedDelivery) => void;
  mobileDateFormat: Intl.DateTimeFormat;
  CorrectedPlanDateCell: any;
}) {
  return (
    <div className="relative flex-1 w-full min-h-0 overflow-auto rounded-md border bg-background">
      <table className="w-full min-w-[470px] table-fixed border-collapse text-left text-[11px]">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[22%]" />
          <col className="w-[14%]" />
          <col className="w-[16%]" />
          <col className="w-[14%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="sticky top-0 z-20 border-b bg-muted text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-30 bg-muted p-2 font-medium shadow-[1px_0_0_0_var(--color-border)]">Объект</th>
            <th className="p-2 font-medium">Водитель</th>
            <th className="p-1 text-center font-medium">План</th>
            <th className="p-1 text-center font-medium">ДатаПланКорр</th>
            <th className="p-1 text-center font-medium">Факт</th>
            <th className="p-1 text-center font-medium">
              <MessageSquareText className="mx-auto h-4 w-4" aria-label="Комментарий водителя" />
            </th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && sitesWithoutDeliveries.length === 0 && (
            <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Нет данных для отображения</td></tr>
          )}
          {data.map((delivery) => (
            <tr key={delivery.id} className="border-b last:border-0" data-testid={`mobile-row-delivery-${delivery.id}`}>
              <td className="sticky left-0 z-10 bg-background p-2 align-top font-medium shadow-[1px_0_0_0_var(--color-border)]">
                <Link href={`/sites/${delivery.siteId}`} className="line-clamp-2 text-primary hover:underline">
                  {delivery.siteName}
                </Link>
              </td>
              <td className="break-words p-2 align-top" title={delivery.driver}>
                {delivery.driver || "—"}
              </td>
              <td className="p-1 text-center align-top leading-tight">
                {delivery.plannedDate ? mobileDateFormat.format(new Date(delivery.plannedDate)) : "—"}
              </td>
              <td className="p-1 text-center align-top leading-tight">
                <CorrectedPlanDateCell
                  deliveryId={delivery.id}
                  siteName={delivery.siteName}
                  value={delivery.correctedPlannedDate}
                  canEdit={canEditCorrectedPlan && Boolean(delivery.plannedDate || delivery.correctedPlannedDate)}
                  compact
                />
              </td>
              <td className="p-1 text-center align-top leading-tight">
                {delivery.actualDate ? mobileDateFormat.format(new Date(delivery.actualDate)) : "—"}
              </td>
              <td className="p-1 text-center align-top">
                {delivery.note ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-primary"
                    onClick={() => setDriverCommentTarget(delivery)}
                    aria-label={`Прочитать комментарий водителя по объекту ${delivery.siteName}`}
                    data-testid={`button-mobile-driver-comment-${delivery.id}`}
                  >
                    <MessageSquareText className="h-4 w-4" />
                  </Button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
          {sitesWithoutDeliveries.map((site) => (
            <tr key={site.id} className="border-b bg-amber-50/60 last:border-0">
              <td className="sticky left-0 z-10 bg-amber-50 p-2 align-top font-medium shadow-[1px_0_0_0_var(--color-border)]">
                <Link href={`/sites/${site.id}`} className="line-clamp-2 text-primary hover:underline">
                  {site.name}
                </Link>
              </td>
              <td className="break-words p-2 align-top">{site.driver || "—"}</td>
              <td className="p-1 text-center align-top">—</td>
              <td className="p-1 text-center align-top">—</td>
              <td className="p-1 text-center align-top">—</td>
              <td className="p-1 text-center align-top">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
