import { useState } from "react";
import {
  getGetDeliveryUploadCleanupHealthQueryKey,
  useGetDeliveryUploadCleanupHealth,
  useListAuditLog,
} from "@workspace/api-client-react";
import type { AuditLogEntry } from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ChevronLeft, ChevronRight, FileText } from "lucide-react";

const PAGE_SIZE = 50;

const METHOD_LABELS: Record<string, string> = {
  POST: "Создание",
  PATCH: "Изменение",
  PUT: "Изменение",
  DELETE: "Удаление",
};

const METHOD_COLORS: Record<string, string> = {
  POST: "bg-green-100 text-green-800",
  PATCH: "bg-blue-100 text-blue-800",
  PUT: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
};

const ENTITY_LABELS: Record<string, string> = {
  products: "Товары",
  categories: "Категории",
  "goods-receipts": "Поступления",
  sites: "Объекты",
  deliveries: "Доставки",
  clients: "Клиенты",
  orders: "Заказы",
  shipments: "Отгрузки",
  users: "Пользователи",
  admin: "Администрирование",
  my: "Мои доставки",
};

const ENTITY_FILTERS = Object.keys(ENTITY_LABELS);

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

export default function Audit() {
  const [page, setPage] = useState(0);
  const [entity, setEntity] = useState<string>("all");
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  const { data, isLoading, isError } = useListAuditLog({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(entity !== "all" ? { entity } : {}),
  });
  const { data: cleanupHealth } = useGetDeliveryUploadCleanupHealth({
    query: {
      queryKey: getGetDeliveryUploadCleanupHealthQueryKey(),
      refetchInterval: 60_000,
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cleanupHealthState =
    cleanupHealth === undefined
      ? "loading"
      : cleanupHealth.hasRepeatedFailures
        ? "repeated-failures"
        : cleanupHealth.isStale
        ? "stale"
        : "fresh";

  return (
    <div
      className="space-y-6"
      data-testid="audit-page"
      data-cleanup-health-state={cleanupHealthState}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          Журнал действий
        </h1>
        <p className="text-sm text-muted-foreground">
          Кто, что и когда изменил в системе. Записи нельзя редактировать или удалять.
        </p>
      </div>

      {cleanupHealth?.hasRepeatedFailures && (
        <Alert variant="destructive" data-testid="alert-delivery-upload-cleanup-failures">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Автоматическая сверка несколько раз завершилась с ошибкой</AlertTitle>
          <AlertDescription>
            Неудачных попыток подряд: {cleanupHealth.consecutiveFailures}.{" "}
            {cleanupHealth.failureKind === "list_timeout"
              ? "Хранилище не успело вернуть список файлов. Повторные попытки выполняются автоматически."
              : "Проверьте состояние автоматической сверки."}{" "}
            Последняя попытка:{" "}
            {cleanupHealth.lastRunAt
              ? formatDateTime(cleanupHealth.lastRunAt)
              : "нет данных"}
            .
          </AlertDescription>
        </Alert>
      )}

      {cleanupHealth?.isStale && (
        <Alert variant="destructive" data-testid="alert-delivery-upload-cleanup">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Уборка загруженных файлов требует внимания</AlertTitle>
          <AlertDescription>
            {cleanupHealth.lastSuccessfulRunAt
              ? `Последняя успешная сверка: ${formatDateTime(cleanupHealth.lastSuccessfulRunAt)}.`
              : "Успешная автоматическая сверка ещё не зарегистрирована."}{" "}
            Последняя попытка:{" "}
            {cleanupHealth.lastRunAt
              ? formatDateTime(cleanupHealth.lastRunAt)
              : "нет данных"}
            {cleanupHealth.failureKind === "list_timeout"
              ? `. Хранилище не успело вернуть список файлов${
                  cleanupHealth.consecutiveFailures > 1
                    ? ` (${cleanupHealth.consecutiveFailures} попытки подряд)`
                    : ""
                }`
              : ""}
            {cleanupHealth.summary
              ? `. Проверено: ${cleanupHealth.summary.scanned}, удалено: ${cleanupHealth.summary.deleted}${
                  cleanupHealth.summary.resumedPhotoDeletions > 0 ||
                  cleanupHealth.summary.resumedDeliveryDeletions > 0
                    ? ` (восстановлено актов: ${cleanupHealth.summary.resumedPhotoDeletions}, доставок: ${cleanupHealth.summary.resumedDeliveryDeletions})`
                    : ""
                }, ошибок: ${cleanupHealth.summary.failed}.`
              : "."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Select
          value={entity}
          onValueChange={(v) => {
            setEntity(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-56" data-testid="select-entity-filter">
            <SelectValue placeholder="Раздел" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все разделы</SelectItem>
            {ENTITY_FILTERS.map((e) => (
              <SelectItem key={e} value={e}>
                {entityLabel(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">Всего записей: {total}</span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Дата и время</TableHead>
              <TableHead>Пользователь</TableHead>
              <TableHead className="w-32">Действие</TableHead>
              <TableHead>Раздел</TableHead>
              <TableHead className="w-20 text-right">Детали</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Загрузка…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-destructive py-8">
                  Не удалось загрузить журнал.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Пока нет записей.
                </TableCell>
              </TableRow>
            )}
            {items.map((entry) => (
              <TableRow key={entry.id} data-testid={`row-audit-${entry.id}`}>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDateTime(entry.createdAt)}
                </TableCell>
                <TableCell className="text-sm">
                  <div className="font-medium">{entry.userName ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{entry.userEmail}</div>
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      METHOD_COLORS[entry.method] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {METHOD_LABELS[entry.method] ?? entry.method}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{entityLabel(entry.entity)}</TableCell>
                <TableCell className="text-right">
                  {entry.meta != null && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDetail(entry)}
                      data-testid={`button-detail-${entry.id}`}
                      title="Показать детали"
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Страница {page + 1} из {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            data-testid="button-prev-page"
          >
            <ChevronLeft className="h-4 w-4" />
            Назад
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages}
            data-testid="button-next-page"
          >
            Вперёд
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={detail != null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Детали действия</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Пользователь: </span>
                {detail.userName ? `${detail.userName} (${detail.userEmail})` : detail.userEmail}
              </div>
              <div>
                <span className="text-muted-foreground">Действие: </span>
                {METHOD_LABELS[detail.method] ?? detail.method} · {entityLabel(detail.entity)}
              </div>
              <div>
                <span className="text-muted-foreground">Дата: </span>
                {formatDateTime(detail.createdAt)}
              </div>
              <div className="pt-2">
                <div className="text-muted-foreground mb-1">Данные:</div>
                <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                  {JSON.stringify(detail.meta, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
