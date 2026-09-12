import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListDeliveriesQueryKey,
  useUpdateDelivery,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface CorrectedPlanDateCellProps {
  deliveryId: string;
  siteName: string;
  value?: string | null;
  canEdit: boolean;
  compact?: boolean;
}

function formatRuDate(value?: string | null) {
  if (!value) return "—";

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "—";

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function CorrectedPlanDateCell({
  deliveryId,
  siteName,
  value,
  canEdit,
  compact = false,
}: CorrectedPlanDateCellProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const savingRef = useRef(false);

  const updateDelivery = useUpdateDelivery({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListDeliveriesQueryKey(),
        });
        savingRef.current = false;
        setOpen(false);
        toast({ title: "Уточнённая дата сохранена" });
      },
      onError: (error) => {
        savingRef.current = false;
        toast({
          title: "Не удалось сохранить уточнённую дату",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const displayValue = formatRuDate(value);

  if (!canEdit) {
    return (
      <span
        data-testid={`text-corrected-plan-date-${deliveryId}`}
        title="ДатаПланКорр"
      >
        {displayValue}
      </span>
    );
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (updateDelivery.isPending || savingRef.current) return;
    if (nextOpen) {
      setDraft(value?.slice(0, 10) ?? "");
    }
    setOpen(nextOpen);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || updateDelivery.isPending) return;

    const input = event.currentTarget.elements.namedItem(
      "correctedPlannedDate",
    ) as HTMLInputElement | null;
    if (!input?.checkValidity()) {
      input?.reportValidity();
      return;
    }

    savingRef.current = true;
    updateDelivery.mutate({
      id: deliveryId,
      data: { correctedPlannedDate: draft || null },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={compact ? "min-w-8 px-2" : undefined}
        aria-label={`Изменить уточнённую плановую дату для ${siteName}`}
        data-testid={`button-corrected-plan-date-${deliveryId}`}
        onClick={() => handleOpenChange(true)}
      >
        {value ? displayValue : compact ? "—" : "Выбрать"}
      </Button>

      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-lg">
        <DialogHeader>
          <DialogTitle>Уточнённая плановая дата</DialogTitle>
          <DialogDescription>{siteName}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="corrected-plan-date">ДатаПланКорр</Label>
            <Input
              id="corrected-plan-date"
              name="correctedPlannedDate"
              type="date"
              value={draft}
              disabled={updateDelivery.isPending}
              data-testid="input-corrected-plan-date"
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Только для информации. График и просрочка рассчитываются по исходной
            плановой дате.
          </p>

          <DialogFooter className="gap-2 sm:space-x-0">
            {draft && (
              <Button
                type="button"
                variant="outline"
                disabled={updateDelivery.isPending}
                data-testid="button-clear-corrected-plan-date"
                onClick={() => setDraft("")}
              >
                Очистить
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={updateDelivery.isPending}
              data-testid="button-cancel-corrected-plan-date"
              onClick={() => handleOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={updateDelivery.isPending}
              data-testid="button-save-corrected-plan-date"
            >
              {updateDelivery.isPending && (
                <Loader2 className="animate-spin" aria-hidden="true" />
              )}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}