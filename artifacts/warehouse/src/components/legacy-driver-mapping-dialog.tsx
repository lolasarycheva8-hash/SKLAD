import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLegacyDriverAssignments,
  useResolveLegacyDriverAssignments,
  useSetLegacyDriverSimilarityReview,
  useListDrivers,
  getGetLegacyDriverAssignmentsQueryKey,
  getListSitesQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
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
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

export function LegacyDriverMappingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (val: boolean) => void;
}) {
  const {
    data: assignments = [],
    isLoading,
    isError,
    error,
  } = useGetLegacyDriverAssignments({
    query: {
      enabled: open,
      retry: false,
      queryKey: getGetLegacyDriverAssignmentsQueryKey(),
    },
  });
  const {
    data: drivers = [],
    isLoading: driversLoading,
    isError: driversError,
    error: driversErrorObj,
  } = useListDrivers();

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPossibleDuplicatesOnly, setShowPossibleDuplicatesOnly] =
    useState(false);
  const [showUnreviewedDuplicatesOnly, setShowUnreviewedDuplicatesOnly] =
    useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [result, setResult] = useState<{
    sites: number;
    deliveries: number;
    total: number;
  } | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resolveMutation = useResolveLegacyDriverAssignments({
    mutation: {
      onSuccess: (data) => {
        setResult({
          sites: data.sitesUpdated,
          deliveries: data.deliveriesUpdated,
          total: data.totalUpdated,
        });
        setSelections({});
        queryClient.invalidateQueries({ queryKey: getGetLegacyDriverAssignmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        setConfirmOpen(false);
      },
      onError: (err: any) => {
        toast({
          title: "Ошибка при сохранении",
          description: err?.data?.error ?? err?.response?.data?.error ?? err.message,
          variant: "destructive",
        });
        setConfirmOpen(false);
      },
    },
  });
  const reviewMutation = useSetLegacyDriverSimilarityReview({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetLegacyDriverAssignmentsQueryKey(),
        });
      },
      onError: (err: any) => {
        toast({
          title: "Не удалось сохранить отметку",
          description:
            err?.data?.error ?? err?.response?.data?.error ?? err.message,
          variant: "destructive",
        });
      },
    },
  });

  const selectedCount = Object.keys(selections).length;

  const { groups: assignmentGroups, metadataError } = useMemo(() => {
    const groups: Array<{
      key: string;
      similarityGroup: string | null;
      similarityReviewed: boolean;
      similarityReviewedAt: string | null;
      similarityReviewedByName: string | null;
      similarityReviewedByDeleted: boolean;
      items: typeof assignments;
    }> = [];
    const duplicateGroupIndexes = new Map<string, number>();

    for (const assignment of assignments) {
      if (!assignment.similarityGroup) {
        groups.push({
          key: `name:${assignment.legacyName}`,
          similarityGroup: null,
          similarityReviewed: false,
          similarityReviewedAt: null,
          similarityReviewedByName: null,
          similarityReviewedByDeleted: false,
          items: [assignment],
        });
        continue;
      }

      const existingIndex = duplicateGroupIndexes.get(
        assignment.similarityGroup,
      );
      if (existingIndex === undefined) {
        duplicateGroupIndexes.set(assignment.similarityGroup, groups.length);
        groups.push({
          key: `similarity:${assignment.similarityGroup}`,
          similarityGroup: assignment.similarityGroup,
          similarityReviewed: assignment.similarityReviewed,
          similarityReviewedAt: assignment.similarityReviewedAt,
          similarityReviewedByName: assignment.similarityReviewedByName,
          similarityReviewedByDeleted: assignment.similarityReviewedByDeleted,
          items: [assignment],
        });
      } else {
        const group = groups[existingIndex];
        if (
          group.similarityReviewed !== assignment.similarityReviewed ||
          group.similarityReviewedAt !== assignment.similarityReviewedAt ||
          group.similarityReviewedByName !== assignment.similarityReviewedByName ||
          group.similarityReviewedByDeleted !== assignment.similarityReviewedByDeleted
        ) {
          return {
            groups: [] as typeof groups,
            metadataError: "Получены противоречивые сведения о проверке группы совпадений. Обновите список.",
          };
        }
        group.items.push(assignment);
      }
    }

    return { groups, metadataError: null };
  }, [assignments]);

  const duplicateNameCount = useMemo(
    () => assignments.filter((assignment) => assignment.similarityGroup).length,
    [assignments],
  );
  const unreviewedDuplicateGroupCount = useMemo(
    () =>
      assignmentGroups.filter(
        (group) => group.similarityGroup && !group.similarityReviewed,
      ).length,
    [assignmentGroups],
  );
  const visibleAssignmentGroups = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("ru-RU");

    return assignmentGroups.filter((group) => {
      if (
        showUnreviewedDuplicatesOnly &&
        (!group.similarityGroup || group.similarityReviewed)
      ) {
        return false;
      }
      if (showPossibleDuplicatesOnly && !group.similarityGroup) {
        return false;
      }
      if (
        normalizedSearchQuery &&
        !group.items.some((assignment) =>
          assignment.legacyName
            .toLocaleLowerCase("ru-RU")
            .includes(normalizedSearchQuery),
        )
      ) {
        return false;
      }
      return true;
    });
  }, [
    assignmentGroups,
    searchQuery,
    showPossibleDuplicatesOnly,
    showUnreviewedDuplicatesOnly,
  ]);

  const summary = useMemo(() => {
    let sites = 0;
    let deliveries = 0;
    for (const legacyName of Object.keys(selections)) {
      const assignment = assignments.find((a) => a.legacyName === legacyName);
      if (assignment) {
        sites += assignment.siteCount;
        deliveries += assignment.deliveryCount;
      }
    }
    return { sites, deliveries };
  }, [selections, assignments]);

  function handleConfirm() {
    if (metadataError) return;
    const mappings = Object.entries(selections).map(
      ([legacyName, driverUserId]) => ({
        legacyName,
        driverUserId,
      }),
    );
    resolveMutation.mutate({ data: { mappings } });
  }

  function handleOpenChange(val: boolean) {
    if (!val && resolveMutation.isPending) return;
    onOpenChange(val);
    if (!val) {
      setTimeout(() => {
        setSelections({});
        setResult(null);
        setConfirmOpen(false);
        setShowPossibleDuplicatesOnly(false);
        setShowUnreviewedDuplicatesOnly(false);
        setSearchQuery("");
      }, 300);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl" data-testid="dialog-legacy-mapping">
          <DialogHeader>
            <DialogTitle>Сопоставление старых имён водителей</DialogTitle>
            <DialogDescription>
              Выберите реальные учётные записи водителей для исторических текстовых имён.
              Эти изменения обновят связанные объекты и доставки.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4" data-testid="mapping-success-result">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <div>
                <h3 className="text-lg font-medium">Сопоставление применено</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Обновлено объектов: <strong>{result.sites}</strong>
                  <br />
                  Обновлено доставок: <strong>{result.deliveries}</strong>
                  <br />
                  Всего назначений: <strong>{result.total}</strong>
                </p>
              </div>
            </div>
          ) : isError || metadataError ? (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4 text-destructive" data-testid="mapping-error">
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm">
                Не удалось загрузить список.
                <br />
                {metadataError ?? (error instanceof Error ? error.message : String(error))}
              </p>
            </div>
          ) : isLoading ? (
            <div className="py-8 flex justify-center text-muted-foreground text-sm" data-testid="mapping-loading">
              Загрузка...
            </div>
          ) : assignments.length === 0 ? (
            <div
              className="py-8 flex justify-center text-muted-foreground text-sm"
              data-testid="mapping-empty"
            >
              Все имена уже сопоставлены.
            </div>
          ) : driversError ? (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4 text-destructive" data-testid="mapping-drivers-error">
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm">
                Ошибка загрузки списка водителей.
                <br />
                {driversErrorObj instanceof Error ? driversErrorObj.message : String(driversErrorObj)}
              </p>
            </div>
          ) : driversLoading ? (
            <div className="py-8 flex justify-center text-muted-foreground text-sm" data-testid="mapping-drivers-loading">
              Загрузка списка водителей...
            </div>
          ) : drivers.length === 0 ? (
            <div className="py-8 flex justify-center text-muted-foreground text-sm" data-testid="mapping-drivers-empty">
              В системе нет водителей для привязки.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="legacy-name-search" className="text-sm font-medium">
                  Поиск по старому имени
                </label>
                <Input
                  id="legacy-name-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Введите имя..."
                  autoComplete="off"
                  data-testid="input-legacy-name-search"
                />
              </div>
              <div className="space-y-3 rounded-md border bg-muted/30 px-3 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label
                      htmlFor="legacy-duplicate-filter"
                      className="text-sm font-medium"
                    >
                      Только вероятные дубли
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Найдено имён: {duplicateNameCount}. Выборы сохраняются при
                      переключении.
                    </p>
                  </div>
                  <Switch
                    id="legacy-duplicate-filter"
                    checked={showPossibleDuplicatesOnly}
                    onCheckedChange={(checked) => {
                      setShowPossibleDuplicatesOnly(checked);
                      if (!checked) setShowUnreviewedDuplicatesOnly(false);
                    }}
                    disabled={duplicateNameCount === 0}
                    aria-label="Показать только вероятные дубли"
                    data-testid="switch-show-possible-duplicates"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 border-t pt-3">
                  <div>
                    <label
                      htmlFor="legacy-unreviewed-duplicate-filter"
                      className="text-sm font-medium"
                    >
                      Только непроверенные совпадения
                    </label>
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="unreviewed-similarity-group-count"
                    >
                      Требуют внимания: {unreviewedDuplicateGroupCount} групп
                    </p>
                  </div>
                  <Switch
                    id="legacy-unreviewed-duplicate-filter"
                    checked={showUnreviewedDuplicatesOnly}
                    onCheckedChange={(checked) => {
                      setShowUnreviewedDuplicatesOnly(checked);
                      if (checked) setShowPossibleDuplicatesOnly(true);
                    }}
                    disabled={unreviewedDuplicateGroupCount === 0}
                    aria-label="Показать только непроверенные совпадения"
                    data-testid="switch-show-unreviewed-duplicates"
                  />
                </div>
              </div>

              <div
                className="max-h-[52vh] space-y-3 overflow-y-auto pr-2"
                data-testid="mapping-list"
              >
                {visibleAssignmentGroups.length === 0 ? (
                  <div
                    className="py-8 text-center text-sm text-muted-foreground"
                    data-testid="mapping-filter-empty"
                  >
                    По заданным условиям ничего не найдено. Измените строку
                    поиска или параметры фильтра.
                  </div>
                ) : visibleAssignmentGroups.map((group) => (
                  <div
                    key={group.key}
                    className={
                      group.similarityGroup
                        ? group.similarityReviewed
                          ? "overflow-hidden rounded-lg border border-border bg-muted/20"
                          : "overflow-hidden rounded-lg border border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/15"
                        : ""
                    }
                    data-testid={
                      group.similarityGroup
                        ? `similarity-group-${group.similarityGroup}`
                        : undefined
                    }
                  >
                    {group.similarityGroup && (
                      <div
                        className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs font-medium ${
                          group.similarityReviewed
                            ? "bg-muted/60 text-muted-foreground"
                            : "border-amber-200 bg-amber-100/70 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                        }`}
                      >
                        {group.similarityReviewed ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {group.similarityReviewed
                            ? "Проверено: это разные варианты"
                            : "Группа вероятных дублей"}
                          {group.similarityReviewed &&
                            group.similarityReviewedAt && (
                              <span
                                className="ml-1 font-normal"
                                data-testid={`similarity-review-meta-${group.similarityGroup}`}
                              >
                                ·{" "}
                                {group.similarityReviewedByName
                                  ? `${group.similarityReviewedByName}${
                                      group.similarityReviewedByDeleted
                                        ? " (учётная запись удалена)"
                                        : ""
                                    }, `
                                  : "администратор удалён, "}
                                {new Intl.DateTimeFormat("ru-RU", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }).format(
                                  new Date(group.similarityReviewedAt),
                                )}
                              </span>
                            )}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            group.similarityReviewed
                              ? "bg-background/70 text-[10px] font-normal"
                              : "border-amber-500/60 bg-background/70 text-[10px] font-normal"
                          }
                        >
                          {group.items.length} варианта
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 px-2 text-xs"
                          disabled={reviewMutation.isPending}
                          onClick={() =>
                            reviewMutation.mutate({
                              data: {
                                similarityGroup: group.similarityGroup!,
                                reviewed: !group.similarityReviewed,
                              },
                            })
                          }
                          data-testid={`button-review-similarity-group-${group.similarityGroup}`}
                        >
                          {reviewMutation.isPending &&
                          reviewMutation.variables?.data.similarityGroup ===
                            group.similarityGroup
                            ? "Сохранение..."
                            : group.similarityReviewed
                              ? "Вернуть предупреждение"
                              : "Это разные варианты"}
                        </Button>
                      </div>
                    )}

                    {group.items.map((a) => {
                      const similarNames = group.items
                        .filter(
                          (candidate) =>
                            candidate.legacyName !== a.legacyName,
                        )
                        .map((candidate) => candidate.legacyName);

                      return (
                        <div
                          key={a.legacyName}
                          className={`flex flex-col gap-3 border-b px-2 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between ${
                            group.similarityGroup
                              ? group.similarityReviewed
                                ? "bg-background/40"
                                : "bg-amber-50/40 dark:bg-amber-950/10"
                              : ""
                          }`}
                          data-testid={`mapping-row-${a.legacyName}`}
                        >
                          <div className="flex-1 pr-4">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {a.legacyName}
                              <Badge
                                variant="secondary"
                                className="h-4 px-1.5 py-0 text-[10px] font-normal"
                              >
                                {a.totalCount}{" "}
                                {a.totalCount === 1
                                  ? "запись"
                                  : a.totalCount >= 2 && a.totalCount <= 4
                                    ? "записи"
                                    : "записей"}
                              </Badge>
                              {similarNames.length > 0 &&
                                !group.similarityReviewed && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/60 text-amber-800 dark:text-amber-300"
                                  data-testid={`similar-name-warning-${a.legacyName}`}
                                >
                                  <AlertTriangle className="mr-1 h-3 w-3" />
                                  Возможный дубль
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Объектов: {a.siteCount} • Доставок:{" "}
                              {a.deliveryCount}
                            </div>
                            {similarNames.length > 0 &&
                              !group.similarityReviewed && (
                              <div className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                                Похоже на: {similarNames.join(", ")}. Проверьте
                                и выберите водителя отдельно.
                              </div>
                            )}
                          </div>
                          <div className="w-full shrink-0 sm:w-64">
                            <Select
                              value={selections[a.legacyName] || ""}
                              onValueChange={(val) =>
                                setSelections((prev) => ({
                                  ...prev,
                                  [a.legacyName]: val,
                                }))
                              }
                            >
                              <SelectTrigger
                                className="h-9 w-full bg-background"
                                data-testid={`select-driver-${a.legacyName}`}
                              >
                                <SelectValue placeholder="Выберите водителя..." />
                              </SelectTrigger>
                              <SelectContent>
                                {drivers.map((d) => (
                                  <SelectItem
                                    key={d.id}
                                    value={d.id}
                                    data-testid={`select-option-driver-${d.id}`}
                                  >
                                    {d.name || d.email}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 border-t pt-4">
            {result ? (
              <Button onClick={() => handleOpenChange(false)} data-testid="button-close-mapping">
                Закрыть
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={resolveMutation.isPending} data-testid="button-cancel-mapping">
                  Отмена
                </Button>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!!metadataError || selectedCount === 0 || resolveMutation.isPending || assignments.length === 0 || drivers.length === 0}
                  data-testid="button-apply-mapping"
                >
                  Применить ({selectedCount})
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen && !metadataError} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-mapping-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердите изменение данных</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 pt-2 text-sm text-muted-foreground">
                <div>Вы собираетесь применить сопоставление для <strong>{selectedCount}</strong> {selectedCount === 1 ? 'имени' : 'имён'}.</div>
                <div className="bg-muted/50 p-3 rounded-md text-foreground space-y-1">
                  <div>Затрагивается объектов: <strong>{summary.sites}</strong></div>
                  <div>Затрагивается доставок: <strong>{summary.deliveries}</strong></div>
                </div>
                <div>Это действие обновит исторические назначения в рабочей базе данных. Продолжить?</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resolveMutation.isPending} data-testid="button-cancel-mapping-confirm">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={!!metadataError || resolveMutation.isPending}
              data-testid="button-confirm-mapping"
            >
              {resolveMutation.isPending ? "Сохранение..." : "Да, применить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}