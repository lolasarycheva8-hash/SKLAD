import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCloseSite,
  getListSitesQueryKey,
  getGetSiteQueryKey,
  getListDeliverySiteLookupQueryKey,
} from "@workspace/api-client-react";
import type { Site } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { format } from "date-fns";

interface CloseSiteDialogProps {
  site: Site | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CloseSiteDialog({
  site,
  open,
  onOpenChange,
}: CloseSiteDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();

  const [closedFrom, setClosedFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open || !site?.id) return;
    setClosedFrom(format(new Date(), "yyyy-MM-dd"));
    setReason("");
  }, [open, site?.id]);

  const closeSite = useCloseSite({
    mutation: {
      onSuccess: () => {
        if (site?.id) {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(site.id) });
          queryClient.invalidateQueries({ queryKey: getListDeliverySiteLookupQueryKey() });
        }
        toast(
          isAdmin
            ? { title: "Объект снят с обслуживания и перенесён в архив" }
            : {
                title: "Запрос на снятие с обслуживания отправлен",
                description:
                   "Объект остаётся на обслуживании до подтверждения администратора.",
              },
        );
        onOpenChange(false);
      },
      onError: (error: any) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!site?.id) return;
    const closed = new Date(`${closedFrom}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(closedFrom) ||
      Number.isNaN(closed.getTime()) ||
      closed.toISOString().slice(0, 10) !== closedFrom
    ) {
      toast({
        title: "Некорректная дата",
        description: "Укажите действительную дату снятия с обслуживания.",
        variant: "destructive",
      });
      return;
    }

    closeSite.mutate({
      id: site.id,
      data: {
        closedFrom,
        reason: reason || null,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Снять с обслуживания объект {site?.name}</DialogTitle>
        </DialogHeader>
        {!isAdmin && site?.pendingClosureRequest ? (
          <p
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            data-testid="status-pending-site-closure-dialog"
          >
            Снятие с обслуживания ожидает подтверждения администратора. Объект остаётся
            на обслуживании до подтверждения.
          </p>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Объект будет перенесён в архив{isAdmin ? "" : " после подтверждения администратора"}.
            Доставки и акты сохранятся. Возобновить обслуживание можно вручную из архива.
          </p>
          <div className="space-y-2">
            <Label htmlFor="closedFrom">Дата снятия с обслуживания*</Label>
            <Input
              id="closedFrom"
              type="date"
              required
              value={closedFrom}
              onChange={(e) => setClosedFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">Причина (комментарий)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!closedFrom || closeSite.isPending}
              data-testid="button-submit-site-closure"
            >
              {isAdmin ? "Снять с обслуживания" : "Отправить запрос"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
