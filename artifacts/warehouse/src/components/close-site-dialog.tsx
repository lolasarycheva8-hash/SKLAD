import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCloseSite,
  getListSitesQueryKey,
  getGetSiteQueryKey,
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
  const [reopenDate, setReopenDate] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open || !site?.id) return;
    setClosedFrom(format(new Date(), "yyyy-MM-dd"));
    setReopenDate("");
    setReason("");
  }, [open, site?.id]);

  const closeSite = useCloseSite({
    mutation: {
      onSuccess: () => {
        if (site?.id) {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(site.id) });
        }
        toast(
          isAdmin
            ? { title: "Объект закрыт" }
            : {
                title: "Запрос на закрытие отправлен",
                description:
                  "Объект остаётся активным до подтверждения администратора.",
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
        description: "Укажите действительную дату закрытия.",
        variant: "destructive",
      });
      return;
    }
    if (reopenDate) {
      const reopen = new Date(`${reopenDate}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(reopenDate) ||
        Number.isNaN(reopen.getTime()) ||
        reopen.toISOString().slice(0, 10) !== reopenDate ||
        reopenDate <= closedFrom
      ) {
        toast({
          title: "Некорректная дата",
          description:
            "Дата открытия должна быть действительной и позже даты закрытия.",
          variant: "destructive",
        });
        return;
      }
    }

    closeSite.mutate({
      id: site.id,
      data: {
        closedFrom,
        reopenDate: reopenDate || null,
        reason: reason || null,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Закрыть объект {site?.name}</DialogTitle>
        </DialogHeader>
        {!isAdmin && site?.pendingClosureRequest ? (
          <p
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            data-testid="status-pending-site-closure-dialog"
          >
            Закрытие ожидает подтверждения администратора. Объект остаётся
            активным до подтверждения.
          </p>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="closedFrom">Дата закрытия (с)*</Label>
            <Input
              id="closedFrom"
              type="date"
              required
              value={closedFrom}
              onChange={(e) => setClosedFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reopenDate">Планируемая дата открытия</Label>
            <Input
              id="reopenDate"
              type="date"
              value={reopenDate}
              onChange={(e) => setReopenDate(e.target.value)}
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
              {isAdmin ? "Закрыть объект" : "Отправить запрос"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
