import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateMyDeliveryComment,
  getListMyDeliveriesQueryKey,
  type Delivery
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface DeliveryCommentDialogProps {
  delivery: Delivery | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeliveryCommentDialog({ delivery, open, onOpenChange }: DeliveryCommentDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const dialogSessionRef = useRef(0);
  const requestSessionsRef = useRef(new WeakMap<object, number>());
  const isOpenRef = useRef(open);

  isOpenRef.current = open;

  useEffect(() => {
    if (open && delivery) {
      setNote(delivery.note || "");
    }
  }, [open, delivery]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen !== isOpenRef.current) {
      dialogSessionRef.current += 1;
      isOpenRef.current = nextOpen;
    }
    onOpenChange(nextOpen);
  };

  const updateComment = useUpdateMyDeliveryComment({
    mutation: {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
        if (
          !isOpenRef.current ||
          requestSessionsRef.current.get(variables) !== dialogSessionRef.current
        ) {
          return;
        }
        handleOpenChange(false);
        toast({ title: "Комментарий сохранён" });
      },
      onError: (err: any, variables) => {
        const isCurrentSession =
          isOpenRef.current &&
          requestSessionsRef.current.get(variables) === dialogSessionRef.current;

        if (err?.status === 404 || err?.response?.status === 404) {
          queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
          if (!isCurrentSession) {
            return;
          }
          handleOpenChange(false);
          toast({
            title: "Доставка больше недоступна",
            description: "Список доставок обновлён.",
          });
          return;
        }
        if (!isCurrentSession) {
          return;
        }
        toast({ title: "Ошибка", description: err.response?.data?.error ?? err.message, variant: "destructive" });
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md w-[90vw] rounded-xl p-5">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-xl">Комментарий к доставке</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Введите ваш комментарий..."
            rows={5}
            className="resize-none text-base"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="h-12 px-5 text-base font-medium" onClick={() => handleOpenChange(false)}>
              Отмена
            </Button>
            <Button
              className="h-12 px-6 text-base font-medium"
              disabled={updateComment.isPending}
              onClick={() => {
                if (delivery) {
                  const variables = { id: delivery.id, data: { note: note.trim() || null } };
                  requestSessionsRef.current.set(variables, dialogSessionRef.current);
                  updateComment.mutate(variables);
                }
              }}
            >
              {updateComment.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              Сохранить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}