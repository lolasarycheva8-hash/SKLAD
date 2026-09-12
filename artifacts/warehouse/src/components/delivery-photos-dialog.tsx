import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDeliveryPhotos,
  useAddDeliveryPhoto,
  useDeleteDeliveryPhoto,
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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, Loader2, Trash2, Upload, Camera, CheckSquare, CheckCircle2 } from "lucide-react";
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

interface DeliveryPhotosDialogProps {
  delivery: Delivery | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canApprove?: boolean;
  canDelete?: boolean;
  canDownload?: boolean;
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

export function DeliveryPhotosDialog({
  delivery,
  open,
  onOpenChange,
  canEdit,
  canApprove = false,
  canDelete = canEdit,
  canDownload = canEdit || canApprove,
}: DeliveryPhotosDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadSession, setUploadSession] =
    useState<DeliveryActUploadSession<File> | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
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
      onSuccess: (_data, variables) => {
        queryClient.setQueryData<DeliveryPhoto[]>(
          getListDeliveryPhotosQueryKey(variables.id),
          (current) => removeDeliveryActById(current, variables.id),
        );
        queryClient.invalidateQueries({ queryKey: getListDeliveryPhotosQueryKey(variables.id) });
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
      },
    },
  });

  const deletePhoto = useDeleteDeliveryPhoto({
    mutation: {
      onMutate: () => ({ dialogCycle: dialogCycleRef.current }),
      onSuccess: (_data, _variables, context) => {
        if (delivery?.id) {
          queryClient.invalidateQueries({ queryKey: getListDeliveryPhotosQueryKey(delivery.id) });
          queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
        }
        if (context?.dialogCycle === dialogCycleRef.current) {
          toast({ title: "Акт удалён" });
        }
      },
      onError: (error: any, _variables, context) => {
        if (context?.dialogCycle !== dialogCycleRef.current) return;
        if (error?.status === 404) {
          if (delivery?.id) {
            queryClient.invalidateQueries({
              queryKey: getListDeliveryPhotosQueryKey(delivery.id),
            });
            queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
          }
          toast({
            title: "Акт уже удалён",
            description: "Список актов обновлён: файл удалил другой администратор.",
          });
          return;
        }
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
            },
          });
        },
      );
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
      const failedCount = results.length - addedCount;
      if (
        dialogOpenRef.current &&
        activeDeliveryIdRef.current === deliveryId
      ) {
        toast({
          title: failedCount === 0 ? "Все акты добавлены" : "Загрузка завершена частично",
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
      <DialogContent className="w-[calc(100vw_-_2rem)] max-w-xl min-w-0 max-h-[90dvh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle>Акты доставки</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {delivery?.workflowStatus === "closed" && (
              <Alert className="bg-emerald-50 border-emerald-200 text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>Доставка закрыта</AlertTitle>
                <AlertDescription>
                  Акты проверены и подтверждены логистом.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {photos?.map((photo) => (
                <div
                  key={photo.id}
                  className="relative group min-h-28 rounded-md overflow-hidden border bg-muted/20"
                >
                  {photo.mimeType.startsWith("image/") ? (
                    <a
                      href={resolveAppUrl(`/api/storage${photo.objectPath}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={resolveAppUrl(`/api/storage${photo.objectPath}`)}
                        alt={photo.fileName}
                        className="w-full h-36 object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      href={resolveAppUrl(`/api/storage${photo.objectPath}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-28 items-center gap-3 p-4 text-sm hover:bg-muted/40"
                    >
                      <FileText className="h-8 w-8 text-orange-600 shrink-0" />
                      <span className="break-all">{photo.fileName}</span>
                    </a>
                  )}
                  {canDelete && delivery?.workflowStatus !== "closed" && (
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => deletePhoto.mutate({ id: photo.id })}
                        disabled={deletePhoto.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
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
              <div className="grid grid-cols-2 gap-2 pt-2 border-t mt-4">
                <Button
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
            )}

            {canApprove && delivery?.workflowStatus === "done" && (
              <div className="pt-2 border-t mt-4">
                <Button
                  className="w-full h-12 text-base font-medium bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleApprove}
                  disabled={approveAct.isPending}
                >
                  {approveAct.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <CheckSquare className="h-5 w-5 mr-2" />}
                  Подтвердить акты
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}