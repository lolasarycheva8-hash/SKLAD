import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCloseSite,
  useReopenSite,
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

  const [closedFrom, setClosedFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reopenDate, setReopenDate] = useState("");
  const [reason, setReason] = useState("");

  const closeSite = useCloseSite({
    mutation: {
      onSuccess: () => {
        if (site?.id) {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(site.id) });
        }
        toast({ title: "Объект закрыт" });
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
            >
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
