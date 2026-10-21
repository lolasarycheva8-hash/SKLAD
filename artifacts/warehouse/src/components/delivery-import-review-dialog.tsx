import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { exportRowsToEditableCsv } from "@/lib/excel-import";
import type {
  DeliveryImportItem,
  DeliveryImportMode,
  DeliveryImportReview,
} from "@/lib/delivery-workspace";
import {
  buildSkippedImportExportRows,
  SKIPPED_IMPORT_EXPORT_HEADERS,
} from "@/lib/delivery-workspace";

type Props = {
  review: DeliveryImportReview | null;
  mode: DeliveryImportMode;
  onCancel: () => void;
  onAddMissingSites: () => void;
  onConfirm: (items: DeliveryImportItem[], mode: DeliveryImportMode) => void;
};

export function DeliveryImportReviewDialog({
  review,
  mode,
  onCancel,
  onAddMissingSites,
  onConfirm,
}: Props) {
  const hasMissingSites =
    review?.skippedRows.some((row) => row.reasonCode === "missing_site") ?? false;
  const canConfirm = !hasMissingSites && (review?.items.length ?? 0) > 0;
  const downloadSkippedRows = () => {
    if (!review) return;
    exportRowsToEditableCsv(
      buildSkippedImportExportRows(review.skippedRows),
      SKIPPED_IMPORT_EXPORT_HEADERS,
      "пропущенные-строки-импорта.csv",
    );
  };

  return (
    <Dialog open={review !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Перед загрузкой будут пропущены строки: {review?.skippedRows.length ?? 0}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Допустимых строк: {review?.items.length ?? 0}. Проверьте полный список
            причин перед продолжением.
          </p>
          {hasMissingSites && (
            <p
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950"
              data-testid="delivery-import-missing-sites-warning"
            >
              Сначала добавьте отсутствующие объекты в справочник, затем повторите
              импорт. Пока объекты не добавлены, загрузка недоступна.
            </p>
          )}
          <div
            className="max-h-[55vh] overflow-auto rounded-md border"
            data-testid="delivery-import-skipped-rows"
          >
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="w-20 px-3 py-2 font-medium">Строка</th>
                  <th className="px-3 py-2 font-medium">Объект</th>
                  <th className="px-3 py-2 font-medium">Причина</th>
                </tr>
              </thead>
              <tbody>
                {review?.skippedRows.map((skipped) => (
                  <tr key={skipped.rowNumber} className="border-b last:border-0">
                    <td className="px-3 py-2 align-top tabular-nums">
                      {skipped.rowNumber}
                    </td>
                    <td className="px-3 py-2 align-top font-medium">
                      {skipped.siteName || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {skipped.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          {hasMissingSites && (
            <Button
              type="button"
              onClick={onAddMissingSites}
              data-testid="button-add-missing-delivery-sites"
            >
              Добавить отсутствующие объекты
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={downloadSkippedRows}
            data-testid="button-download-skipped-import-rows"
          >
            Скачать отчёт
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {canConfirm ? "Отмена" : "Закрыть"}
          </Button>
          {canConfirm && (
            <Button
              type="button"
              onClick={() => review && onConfirm(review.items, mode)}
              data-testid="button-confirm-import-with-skips"
            >
              Загрузить остальные
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}