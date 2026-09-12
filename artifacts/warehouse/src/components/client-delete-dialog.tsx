import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  clientName: string | null;
  error: string | null;
  blockingSites: {
    count: number;
    preview: Array<{ id: string; name: string }>;
  } | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onViewSites: () => void;
};

export function ClientDeleteDialog({
  clientName,
  error,
  blockingSites,
  isPending,
  onClose,
  onConfirm,
  onViewSites,
}: Props) {
  return (
    <AlertDialog
      open={clientName !== null}
      onOpenChange={(open) => !open && !isPending && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить клиента?</AlertDialogTitle>
          <AlertDialogDescription>
            Клиент «{clientName}» будет удалён без возможности восстановления.
          </AlertDialogDescription>
          {error && (
            <p
              className="text-sm font-medium text-destructive"
              role="alert"
              data-testid="text-delete-client-error"
            >
              {error}
            </p>
          )}
          {blockingSites && (
            <div className="space-y-2 text-sm" data-testid="client-delete-blocking-sites">
              <p>
                Связанных объектов: <strong>{blockingSites.count}</strong>
              </p>
              {blockingSites.preview.length > 0 && (
                <p className="text-muted-foreground">
                  {blockingSites.preview.map((site) => site.name).join(", ")}
                </p>
              )}
              <Button type="button" variant="link" className="h-auto p-0" onClick={onViewSites}>
                Перейти к объектам клиента
              </Button>
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isPending}
            data-testid="button-cancel-delete-client"
          >
            Отмена
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={onConfirm}
            data-testid="button-confirm-delete-client"
          >
            {isPending ? "Удаление..." : "Удалить"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}