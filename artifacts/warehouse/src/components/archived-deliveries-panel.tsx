import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  FileText,
  Loader2,
  RotateCcw,
  Search,
} from "lucide-react";
import type { Delivery } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 500;
const archiveDateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatArchiveDate(value: string | null) {
  return value ? archiveDateFormat.format(new Date(value)) : "—";
}

function getWorkflowLabel(delivery: Delivery) {
  if (delivery.workflowStatus === "closed") return "Закрыта";
  if (delivery.workflowStatus === "done") return "Выполнена";
  return "В плане";
}

function searchableValues(delivery: Delivery) {
  return [
    delivery.siteName,
    delivery.siteAddress,
    delivery.driver,
    delivery.plannedDate,
    delivery.actualDate,
    delivery.workflowStatus,
    delivery.status,
    delivery.archivedAt,
    delivery.archivedByName,
  ];
}

function ArchivedDeliveryCard({
  delivery,
  onOpenPhotos,
  onRestore,
  restorePendingId,
}: {
  delivery: Delivery;
  onOpenPhotos: (delivery: Delivery) => void;
  onRestore: (delivery: Delivery) => void;
  restorePendingId: string | null;
}) {
  const restorePending = restorePendingId !== null;
  const isRestoreTarget = restorePendingId === delivery.id;

  return (
    <div
      className="mb-3 flex w-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm"
      data-testid={`mobile-card-archived-delivery-${delivery.id}`}
    >
      <div className="border-b p-3 pb-2">
        <div className="mb-1 flex items-start justify-between gap-2">
          <Link
            href={`/sites/${delivery.siteId}`}
            className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-tight text-primary"
            data-testid={`mobile-link-archived-delivery-site-${delivery.id}`}
          >
            {delivery.siteName}
          </Link>
          <span
            className="shrink-0 text-xs font-medium text-muted-foreground"
            data-testid={`mobile-status-archived-delivery-${delivery.id}`}
          >
            {getWorkflowLabel(delivery)}
          </span>
        </div>
        <div className="mb-2 truncate text-sm text-muted-foreground">
          {delivery.driver || "Водитель не назначен"}
        </div>
        <div className="grid grid-cols-2 gap-2 rounded bg-muted/40 p-1.5 text-xs">
          <div className="flex min-w-0 flex-col">
            <span className="text-muted-foreground">План</span>
            <span className="font-medium">
              {formatArchiveDate(delivery.plannedDate)}
            </span>
          </div>
          <div className="flex min-w-0 flex-col text-right">
            <span className="text-muted-foreground">Факт</span>
            <span className="font-medium">
              {formatArchiveDate(delivery.actualDate)}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2 p-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <div className="text-muted-foreground">Удалена</div>
            <div className="break-words font-medium">
              {formatArchiveDate(delivery.archivedAt)}
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-muted-foreground">Кем</div>
            <div className="break-words font-medium">
              {delivery.archivedByName || "—"}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full text-sm"
            onClick={() => onOpenPhotos(delivery)}
            data-testid={`mobile-card-button-archived-acts-${delivery.id}`}
          >
            <FileText className="mr-2 h-4 w-4" />
            Акты ({delivery.photosCount})
          </Button>
          <Button
            type="button"
            className="h-11 w-full whitespace-normal text-sm leading-tight"
            onClick={() => onRestore(delivery)}
            disabled={restorePending}
            data-testid={`mobile-card-button-restore-${delivery.id}`}
          >
            {isRestoreTarget ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4 shrink-0" />
            )}
            Вернуть в график доставок
          </Button>
        </div>
      </div>
    </div>
  );
}

function ArchivePager({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;

  return (
    <div className="flex items-center justify-end gap-2 pt-2 text-xs">
      <span className="text-muted-foreground">
        {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} из {total}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        data-testid="button-archived-previous-page"
      >
        Назад
      </Button>
      <span>
        {page} / {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        data-testid="button-archived-next-page"
      >
        Далее
      </Button>
    </div>
  );
}

export function ArchivedDeliveriesPanel({
  data,
  search,
  onSearchChange,
  isLoading,
  isError,
  onRetry,
  onOpenPhotos,
  onRestore,
  restorePendingId,
  restoreError,
  onDismissRestoreError,
}: {
  data: Delivery[];
  search: string;
  onSearchChange: (value: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenPhotos: (delivery: Delivery) => void;
  onRestore: (delivery: Delivery) => void;
  restorePendingId: string | null;
  restoreError: string | null;
  onDismissRestoreError: () => void;
}) {
  const [page, setPage] = useState(1);
  const filteredData = useMemo(() => {
    const searchValue = search.trim().toLocaleLowerCase("ru");
    if (!searchValue) return data;
    return data.filter((delivery) =>
      searchableValues(delivery).some((value) =>
        String(value ?? "").toLocaleLowerCase("ru").includes(searchValue),
      ),
    );
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  const visibleData = filteredData.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  if (isLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center rounded-md border bg-background p-8 text-muted-foreground"
        data-testid="archived-deliveries-loading"
      >
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка удалённых доставок…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border bg-background p-8 text-center"
        data-testid="archived-deliveries-error"
      >
        <p className="text-sm text-destructive">
          Не удалось загрузить удалённые доставки.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          data-testid="button-retry-archived-deliveries"
        >
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
        <div className="relative w-full sm:w-[220px]">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-8 bg-background pl-8 text-xs"
            placeholder="Поиск по части слова..."
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
              setPage(1);
            }}
            data-testid="input-search-deliveries-archived"
          />
        </div>
        <span
          className="text-xs text-muted-foreground"
          data-testid="counter-archived-deliveries"
        >
          Найдено: {filteredData.length}
        </span>
      </div>

      {restoreError && (
        <div
          className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="archived-restore-error"
        >
          <span>{restoreError}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-destructive hover:text-destructive"
            onClick={onDismissRestoreError}
            data-testid="button-dismiss-archived-restore-error"
          >
            Закрыть
          </Button>
        </div>
      )}

      {filteredData.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center rounded-md border bg-background p-8 text-center text-muted-foreground"
          data-testid="archived-deliveries-empty"
        >
          {search.trim()
            ? "По вашему поиску удалённых доставок не найдено"
            : "В удалённых доставках пока пусто"}
        </div>
      ) : (
        <>
          <div className="space-y-3 overflow-y-auto px-1 py-1 md:hidden">
            {visibleData.map((delivery) => (
              <ArchivedDeliveryCard
                key={delivery.id}
                delivery={delivery}
                onOpenPhotos={onOpenPhotos}
                onRestore={onRestore}
                restorePendingId={restorePendingId}
              />
            ))}
          </div>

          <div className="hidden min-h-0 flex-1 overflow-auto rounded-md border bg-background md:block">
            <table className="w-full min-w-[930px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Объект</th>
                  <th className="p-2 font-medium">Водитель</th>
                  <th className="p-2 text-center font-medium">План</th>
                  <th className="p-2 text-center font-medium">Факт</th>
                  <th className="p-2 text-center font-medium">Статус</th>
                  <th className="p-2 font-medium">Удалена</th>
                  <th className="p-2 font-medium">Кем</th>
                  <th className="p-2 text-center font-medium">Акты</th>
                  <th className="p-2 text-center font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {visibleData.map((delivery) => (
                  <tr
                    key={delivery.id}
                    className="border-b last:border-0"
                    data-testid={`row-archived-delivery-${delivery.id}`}
                  >
                    <td className="max-w-[210px] p-2 font-medium">
                      <Link
                        href={`/sites/${delivery.siteId}`}
                        className="text-primary hover:underline"
                        data-testid={`link-archived-delivery-site-${delivery.id}`}
                      >
                        {delivery.siteName}
                      </Link>
                    </td>
                    <td className="max-w-[180px] break-words p-2">
                      {delivery.driver || "—"}
                    </td>
                    <td className="whitespace-nowrap p-2 text-center">
                      {formatArchiveDate(delivery.plannedDate)}
                    </td>
                    <td className="whitespace-nowrap p-2 text-center">
                      {formatArchiveDate(delivery.actualDate)}
                    </td>
                    <td
                      className={cn("whitespace-nowrap p-2 text-center")}
                      data-testid={`status-archived-delivery-${delivery.id}`}
                    >
                      {getWorkflowLabel(delivery)}
                    </td>
                    <td className="whitespace-nowrap p-2">
                      {formatArchiveDate(delivery.archivedAt)}
                    </td>
                    <td className="max-w-[150px] break-words p-2">
                      {delivery.archivedByName || "—"}
                    </td>
                    <td className="p-2 text-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenPhotos(delivery)}
                        data-testid={`button-archived-acts-${delivery.id}`}
                      >
                        <FileText className="mr-1.5 h-4 w-4" />
                        {delivery.photosCount}
                      </Button>
                    </td>
                    <td className="p-2 text-center">
                      <Button
                        type="button"
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => onRestore(delivery)}
                        disabled={restorePendingId !== null}
                        data-testid={`button-restore-delivery-${delivery.id}`}
                      >
                        {restorePendingId === delivery.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        )}
                        Вернуть в график доставок
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ArchivePager
            page={page}
            total={filteredData.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}