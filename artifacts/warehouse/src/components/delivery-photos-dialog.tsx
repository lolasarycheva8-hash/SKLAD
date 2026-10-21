import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDeliveryPhotos,
  useAddDeliveryPhoto,
  useDeleteDeliveryPhoto,
  useUpdateDeliveryPhotoCaption,
  useApproveDeliveryAct,
  getListDeliveryPhotosQueryKey,
  getListDeliveriesQueryKey,
  getListMyDeliveriesQueryKey,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, FileWarning, Loader2, Trash2, Upload, Camera, CheckSquare, CheckCircle2 } from "lucide-react";
import type { Delivery, DeliveryPhoto } from "@workspace/api-client-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  removeDeliveryActById,
  getRetryableDeliveryActFiles,
  type DeliveryActUploadSession,
  uploadDeliveryActsSequentially,
} from "@/lib/delivery-workspace";
import { downloadFileResponse } from "@/lib/download-file";
import { resolveAppUrl } from "@/lib/download-file";
import { formatMoscowDate } from "@/lib/moscow-date";

interface DeliveryPhotosDialogProps {
  delivery: Delivery | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canApprove?: boolean;
  canDelete?: boolean;
  canDownload?: boolean;
  allowConfirmCompletion?: boolean;
}

const pendingDeliveryUploads = new Set<string>();
const pendingDeliveryUploadListeners = new Set<() => void>();

function notifyPendingDeliveryUploadListeners() {
  for (const listener of pendingDeliveryUploadListeners) listener();
}

function subscribeToPendingDeliveryUploads(listener: () => void) {
  pendingDeliveryUploadListeners.add(listener);
  return () => pendingDeliveryUploadListeners.delete(listener);
}

function beginDeliveryUpload(deliveryId: string) {
  if (pendingDeliveryUploads.has(deliveryId)) return null;
  pendingDeliveryUploads.add(deliveryId);
  notifyPendingDeliveryUploadListeners();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingDeliveryUploads.delete(deliveryId);
    notifyPendingDeliveryUploadListeners();
  };
}

function useIsDeliveryUploadPending(deliveryId?: string) {
  return useSyncExternalStore(
    subscribeToPendingDeliveryUploads,
    () => Boolean(deliveryId && pendingDeliveryUploads.has(deliveryId)),
    () => false,
  );
}

function mergeAttachedDeliveryPhoto(
  photos: readonly DeliveryPhoto[] | undefined,
  attached: DeliveryPhoto,
): DeliveryPhoto[] | undefined {
  if (!photos) return photos;
  const existingIndex = photos.findIndex((photo) => photo.id === attached.id);
  if (existingIndex === -1) return [...photos, attached];
  return photos.map((photo, index) =>
    index === existingIndex ? attached : photo,
  );
}

function DeliveryActCard({
  photo,
  deliveryId,
  canCaption,
  canDelete,
  canDownload,
  onDelete,
  isDeleting,
}: {
  photo: DeliveryPhoto;
  deliveryId: string;
  canCaption: boolean;
  canDelete: boolean;
  canDownload: boolean;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const queryClient = useQueryClient();
  const updateCaption = useUpdateDeliveryPhotoCaption();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [captionError, setCaptionError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function saveCaption() {
    if (saving) return;
    setSaving(true);
    setCaptionError("");
    try {
      const updated = await updateCaption.mutateAsync({
        id: photo.id,
        data: { caption: draft.trim() || null },
      });
      queryClient.setQueryData<DeliveryPhoto[]>(
        getListDeliveryPhotosQueryKey(deliveryId),
        (current) => current?.map((item) => item.id === photo.id ? updated : item),
      );
      if (mounted.current) setEditing(false);
    } catch (error: any) {
      if (mounted.current) {
        setCaptionError(error?.data?.error ?? error?.response?.data?.error ?? error?.message ?? "Не удалось сохранить подпись");
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  const [isMissing, setIsMissing] = useState(false);
  const [hasImagePreviewError, setHasImagePreviewError] = useState(false);
  const previewUrl = resolveAppUrl(`/api/storage${photo.objectPath}`);
  const downloadUrl = `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}download=1`;

  useEffect(() => {
    let isCurrent = true;
    setIsMissing(false);
    setHasImagePreviewError(false);

    fetch(previewUrl, {
      method: "HEAD",
      credentials: "same-origin",
    })
      .then((response) => {
        if (isCurrent && response.status === 404) setIsMissing(true);
      })
      .catch(() => {
        // A transient connectivity failure is not evidence that the stored object is missing.
      });

    return () => {
      isCurrent = false;
    };
  }, [previewUrl]);

  return (
    <div
      className="relative group min-h-28 rounded-md overflow-hidden border bg-muted/20"
      data-testid={`card-delivery-act-${photo.id}`}
    >
      {isMissing ? (
        <div
          className="flex min-h-36 flex-col items-center justify-center gap-2 p-4 text-center"
          role="status"
          data-testid={`status-delivery-act-missing-${photo.id}`}
        >
          <FileWarning className="h-8 w-8 text-amber-600" />
          <p className="font-medium break-all">{photo.fileName}</p>
          <p className="text-sm text-muted-foreground">
            Файл отсутствует в хранилище. Просмотр и скачивание недоступны.
          </p>
        </div>
      ) : (
        <>
          {photo.mimeType.startsWith("image/") && !hasImagePreviewError ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Открыть акт ${photo.fileName}`}
              data-testid={`link-view-delivery-act-${photo.id}`}
            >
              <img
                src={previewUrl}
                alt={photo.fileName}
                className="block w-full h-auto max-h-[65dvh] object-contain"
                onError={() => setHasImagePreviewError(true)}
              />
            </a>
          ) : (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Открыть акт ${photo.fileName}`}
              data-testid={`link-view-delivery-act-${photo.id}`}
              className="flex min-h-28 items-center gap-3 p-4 text-sm hover:bg-muted/40"
            >
              <FileText className="h-8 w-8 text-orange-600 shrink-0" />
              <span className="min-w-0">
                <span className="block break-all">{photo.fileName}</span>
                {hasImagePreviewError && (
                  <span className="mt-1 block text-muted-foreground">
                    Предпросмотр недоступен — откройте файл отдельно
                  </span>
                )}
              </span>
            </a>
          )}
          {canDownload && (
            <div className="border-t bg-background/90 p-2">
              <Button variant="outline" size="sm" asChild className="w-full">
                <a
                  href={downloadUrl}
                  download={photo.fileName}
                  aria-label={`Скачать акт ${photo.fileName}`}
                  data-testid={`button-download-delivery-act-${photo.id}`}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Скачать
                </a>
              </Button>
            </div>
          )}
        </>
      )}
      <div className="border-t bg-background p-3 space-y-2">
        {editing ? (
          <>
            <Input
              aria-label={`Подпись акта ${photo.fileName}`}
              placeholder="Например, Допы Коробочка"
              maxLength={200}
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); void saveCaption(); }
              }}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void saveCaption()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить"}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { setEditing(false); setCaptionError(""); }}>
                Отмена
              </Button>
            </div>
            {captionError && <p role="alert" className="text-sm text-destructive">{captionError}</p>}
          </>
        ) : (
          <>
            {photo.caption && <p className="text-sm font-medium break-words">{photo.caption}</p>}
            {canCaption && (
              <Button type="button" variant="outline" size="sm" className="min-h-10 w-full" onClick={() => { setDraft(photo.caption ?? ""); setCaptionError(""); setEditing(true); }}>
                {photo.caption ? "Изменить подпись" : "Добавить подпись"}
              </Button>
            )}
          </>
        )}
      </div>
      {canDelete && !isMissing && (
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={onDelete}
            disabled={isDeleting}
            aria-label={`Удалить акт ${photo.fileName}`}
            data-testid={`button-delete-delivery-act-${photo.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function DeliveryPhotosDialog({
  delivery,
  open,
  onOpenChange,
  canEdit,
  canApprove = false,
  canDelete = canEdit,
  canDownload = canEdit || canApprove,
  allowConfirmCompletion = false,
}: DeliveryPhotosDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadSession, setUploadSession] =
    useState<DeliveryActUploadSession<File> | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmedActualDate, setConfirmedActualDate] = useState(formatMoscowDate);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [completedHere, setCompletedHere] = useState(false);
  const needsConfirmation = allowConfirmCompletion && !delivery?.actualDate && !completedHere;
  useEffect(() => {
    setConfirmedActualDate(formatMoscowDate());
    setSelectedFiles([]);
    setCompletedHere(false);
  }, [delivery?.id, open]);
  const activeDeliveryIdRef = useRef(delivery?.id);
  const dialogOpenRef = useRef(open);
  const dialogCycleRef = useRef(0);
  const dialogIdentityRef = useRef({
    deliveryId: delivery?.id,
    open,
  });
  if (
    dialogIdentityRef.current.deliveryId !== delivery?.id ||
    dialogIdentityRef.current.open !== open
  ) {
    dialogCycleRef.current += 1;
    dialogIdentityRef.current = {
      deliveryId: delivery?.id,
      open,
    };
  }
  activeDeliveryIdRef.current = delivery?.id;
  dialogOpenRef.current = open;
  const uploadResults =
    uploadSession && uploadSession.deliveryId === delivery?.id
      ? uploadSession.results
      : [];
  const isProcessingCurrentDelivery = useIsDeliveryUploadPending(delivery?.id);

  useEffect(() => {
    setUploadSession(null);
  }, [delivery?.id, open]);

  useEffect(
    () => () => {
      dialogCycleRef.current += 1;
    },
    [],
  );

  const { data: photos, isLoading } = useListDeliveryPhotos(delivery?.id ?? "", {
    query: {
      enabled: !!delivery?.id && open,
      queryKey: getListDeliveryPhotosQueryKey(delivery?.id ?? ""),
    },
  });

  const addPhoto = useAddDeliveryPhoto({
    mutation: {
      onSuccess: (data, variables) => {
        queryClient.setQueryData<DeliveryPhoto[]>(
          getListDeliveryPhotosQueryKey(variables.id),
          (current) => mergeAttachedDeliveryPhoto(current, data),
        );
      },
    },
  });

  const deletePhoto = useDeleteDeliveryPhoto({
    mutation: {
      onMutate: () => ({
        dialogCycle: dialogCycleRef.current,
        deliveryId: activeDeliveryIdRef.current,
      }),
      onSuccess: (_data, variables, context) => {
        if (context?.deliveryId) {
          queryClient.setQueryData<DeliveryPhoto[]>(
            getListDeliveryPhotosQueryKey(context.deliveryId),
            (current) => removeDeliveryActById(current, variables.id),
          );
          queryClient.invalidateQueries({ queryKey: getListDeliveryPhotosQueryKey(context.deliveryId) });
          queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
        }
        if (context?.dialogCycle === dialogCycleRef.current) {
          toast({ title: "Акт удалён" });
        }
      },
      onError: (error: any, variables, context) => {
        if (error?.status === 404) {
          if (context?.deliveryId) {
            queryClient.setQueryData<DeliveryPhoto[]>(
              getListDeliveryPhotosQueryKey(context.deliveryId),
              (current) => removeDeliveryActById(current, variables.id),
            );
            queryClient.invalidateQueries({
              queryKey: getListDeliveryPhotosQueryKey(context.deliveryId),
            });
            queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
          }
          if (context?.dialogCycle === dialogCycleRef.current) {
            toast({
              title: "Акт уже удалён",
              description: "Список актов обновлён: файл удалил другой администратор.",
            });
          }
          return;
        }
        if (context?.dialogCycle !== dialogCycleRef.current) return;
        toast({
          title: "Ошибка",
          description: error?.data?.error ?? error?.message,
          variant: "destructive",
        });
      },
    },
  });

  const approveAct = useApproveDeliveryAct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
      }
    }
  });

  function handleDialogOpenChange(nextOpen: boolean) {
    const deliveryId = activeDeliveryIdRef.current;
    if (
      dialogIdentityRef.current.deliveryId !== deliveryId ||
      dialogIdentityRef.current.open !== nextOpen
    ) {
      dialogCycleRef.current += 1;
      dialogIdentityRef.current = { deliveryId, open: nextOpen };
    }
    dialogOpenRef.current = nextOpen;
    if (!nextOpen) setUploadSession(null);
    onOpenChange(nextOpen);
  }

  function handleApprove() {
    if (!delivery?.id) return;
    const deliveryId = delivery.id;
    const dialogCycle = dialogCycleRef.current;
    const isOriginDialogStillOpen = () =>
      dialogOpenRef.current &&
      activeDeliveryIdRef.current === deliveryId &&
      dialogCycleRef.current === dialogCycle;

    approveAct.mutate(
      { id: deliveryId },
      {
        onSuccess: () => {
          if (!isOriginDialogStillOpen()) return;
          toast({ title: "Акты подтверждены, доставка закрыта" });
          handleDialogOpenChange(false);
        },
        onError: (err: any) => {
          if (!isOriginDialogStillOpen()) return;
          toast({
            title: "Ошибка",
            description: err.response?.data?.error ?? err.message,
            variant: "destructive",
          });
        },
      },
    );
  }

  const { uploadFile } = useUpload({
    requestBody: delivery?.id ? { deliveryId: delivery.id } : undefined,
  });

  async function uploadFiles(files: File[], keepAddedResults = false) {
    if (!delivery?.id || files.length === 0) return;
    const deliveryId = delivery.id;
    const finishDeliveryUpload = beginDeliveryUpload(deliveryId);
    if (!finishDeliveryUpload) return;

    try {
      const results = await uploadDeliveryActsSequentially(
        files,
        uploadFile,
        async (file, uploaded) => {
          await addPhoto.mutateAsync({
            id: deliveryId,
            data: {
              objectPath: uploaded.objectPath,
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              ...(needsConfirmation ? { confirmedActualDate } : {}),
            },
          });
        },
      );
      await Promise.allSettled([
        queryClient.refetchQueries({
          queryKey: getListDeliveryPhotosQueryKey(deliveryId),
          exact: true,
          type: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: getListDeliveriesQueryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: getListMyDeliveriesQueryKey(),
        }),
      ]);
      if (
        dialogOpenRef.current &&
        activeDeliveryIdRef.current === deliveryId
      ) {
        setUploadSession((current) => ({
          deliveryId,
          results: [
            ...(keepAddedResults && current?.deliveryId === deliveryId
              ? current.results.filter((result) => result.status === "added")
              : []),
            ...results,
          ],
        }));
      }

      const addedCount = results.filter((result) => result.status === "added").length;
      if (addedCount > 0 && activeDeliveryIdRef.current === deliveryId) {
        setCompletedHere(true);
        setSelectedFiles([]);
      }
      const failedCount = results.length - addedCount;
      if (
        dialogOpenRef.current &&
        activeDeliveryIdRef.current === deliveryId
      ) {
        toast({
          title: failedCount === 0 ? "Все акты добавлены" : addedCount === 0 ? "Не удалось загрузить акты" : "Загрузка завершена частично",
          description: `Добавлено: ${addedCount}. Не удалось добавить: ${failedCount}.`,
          variant: failedCount > 0 ? "destructive" : "default",
        });
      }
    } finally {
      finishDeliveryUpload();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (needsConfirmation) {
      setSelectedFiles(files);
      return;
    }
    await uploadFiles(files);
  }

  async function handleDownload() {
    if (!delivery?.id || isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadFileResponse(
        `/api/deliveries/${encodeURIComponent(delivery.id)}/acts/download`,
        `акты-доставки-${delivery.id}.zip`,
      );
    } catch (error) {
      toast({
        title: "Не удалось скачать акты",
        description: error instanceof Error ? error.message : "Повторите попытку",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent className="w-[calc(100vw_-_2rem)] max-w-5xl min-w-0 max-h-[95dvh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0 border-b pb-3 pr-6">
          <DialogTitle>Акты доставки</DialogTitle>
          <DialogDescription className="text-base text-foreground break-words pr-6">
            <span className="block font-semibold">Объект: {delivery?.siteName || "Не указан"}</span>
            <span className="block">Адрес: {delivery?.siteAddress || "Не указан"}</span>
            <span className="block">
              Фактическая дата доставки: {delivery?.actualDate
                ? delivery.actualDate.slice(0, 10).split("-").reverse().join(".")
                : "Не указана"}
            </span>
          </DialogDescription>
          {canApprove && delivery?.workflowStatus === "done" && (
            <Button
              type="button"
              className="mt-2 h-11 w-fit bg-emerald-600 hover:bg-emerald-700"
              onClick={handleApprove}
              disabled={approveAct.isPending || isLoading || isProcessingCurrentDelivery}
            >
              {approveAct.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckSquare className="mr-2 h-5 w-5" />}
              Согласовать акт
            </Button>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto space-y-4">
            {delivery?.workflowStatus === "closed" && (
              <Alert className="bg-emerald-50 border-emerald-200 text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>Доставка закрыта</AlertTitle>
                <AlertDescription>
                  Акты проверены и подтверждены логистом.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 gap-3">
              {photos?.map((photo) => (
                <DeliveryActCard
                  key={`${delivery?.id}-${dialogCycleRef.current}-${photo.id}`}
                  photo={photo}
                  deliveryId={delivery!.id}
                  canCaption={canEdit && delivery?.workflowStatus !== "closed"}
                  canDelete={canDelete && delivery?.workflowStatus !== "closed"}
                  canDownload={canDownload}
                  onDelete={() => deletePhoto.mutate({ id: photo.id })}
                  isDeleting={deletePhoto.isPending}
                />
              ))}
              {photos?.length === 0 && (
                <div className="col-span-full text-center py-8 text-muted-foreground">
                  Нет загруженных актов
                </div>
              )}
            </div>

            {canDownload && (photos?.length ?? 0) > 0 && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleDownload}
                disabled={isDownloading}
                data-testid="button-download-delivery-acts"
              >
                {isDownloading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {isDownloading ? "Формируем архив..." : "Скачать все акты"}
              </Button>
            )}

            {uploadResults.length > 0 && (
              <Alert
                variant={
                  uploadResults.some((result) => result.status === "failed")
                    ? "destructive"
                    : "default"
                }
              >
                <AlertTitle>Результат загрузки</AlertTitle>
                <AlertDescription className="space-y-3">
                  <ul className="space-y-1">
                    {uploadResults.map((result, index) => (
                      <li key={`${result.file.name}-${index}`}>
                        {result.status === "added" ? "Добавлен" : "Не добавлен"}:{" "}
                        <span className="break-all">{result.file.name}</span>
                        {result.status === "failed" && (
                          <span className="block">
                            {(() => {
                              const error = result.error as {
                                data?: { error?: string };
                                response?: { data?: { error?: string } };
                                message?: string;
                              } | null;
                              return error?.data?.error ?? error?.response?.data?.error ?? error?.message ?? "Не удалось добавить акт. Повторите попытку.";
                            })()}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {uploadResults.some((result) => result.status === "failed") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                       disabled={isProcessingCurrentDelivery}
                      onClick={() =>
                        uploadFiles(
                          getRetryableDeliveryActFiles(
                            uploadSession,
                            delivery?.id,
                          ),
                          true,
                        )
                      }
                    >
                      Повторить неудачные
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {canEdit && delivery?.workflowStatus !== "closed" && (
              <div className="space-y-3">
                {needsConfirmation && (
                  <div className="space-y-2 rounded-md border p-3">
                    <label htmlFor="act-actual-date" className="text-sm font-medium">Фактическая дата доставки</label>
                    <Input id="act-actual-date" type="date" value={confirmedActualDate} max={formatMoscowDate()}
                      disabled={isProcessingCurrentDelivery}
                      onChange={(event) => setConfirmedActualDate(event.target.value)} />
                    <p className="text-sm text-muted-foreground">Проверьте дату и выберите акт. Доставка будет отмечена выполненной только после успешного прикрепления файла.</p>
                    {!delivery?.plannedDate && <p role="alert">Сначала попросите логиста назначить плановую дату.</p>}
                    {selectedFiles.length > 0 && (
                      <>
                        <p className="text-sm break-all">{selectedFiles.map((file) => file.name).join(", ")}</p>
                        <Button type="button" className="w-full whitespace-normal h-auto min-h-12"
                          disabled={isProcessingCurrentDelivery || !confirmedActualDate || !delivery?.plannedDate}
                          onClick={() => void uploadFiles(selectedFiles)}>
                          Подтвердить доставку и загрузить акт
                        </Button>
                      </>
                    )}
                  </div>
                )}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t mt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="relative overflow-hidden w-full h-12"
                   disabled={isProcessingCurrentDelivery}
                >
                  <input
                    type="file"
                    aria-label="Сделать снимок"
                    accept="image/*"
                    capture="environment"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleFileChange}
                     disabled={isProcessingCurrentDelivery}
                  />
                   {isProcessingCurrentDelivery ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin text-muted-foreground" />
                  ) : (
                    <Camera className="h-5 w-5 mr-2 text-slate-700" />
                  )}
                  Камера
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="relative overflow-hidden w-full h-12"
                   disabled={isProcessingCurrentDelivery}
                >
                  <input
                    type="file"
                    aria-label="Выбрать файл"
                    accept="image/*,application/pdf"
                    multiple
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleFileChange}
                     disabled={isProcessingCurrentDelivery}
                  />
                   {isProcessingCurrentDelivery ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="h-5 w-5 mr-2 text-slate-700" />
                  )}
                  Галерея
                </Button>
              </div>
              </div>
            )}

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}