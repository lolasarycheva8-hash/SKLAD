import { useEffect, useMemo, useState } from "react";
import {
  type Delivery,
  type DriverUser,
  useUpdateDeliveriesBulk,
} from "@workspace/api-client-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type BulkDeliveryRow = Delivery & {
  siteBranch: string;
};

export const UNASSIGNED_DRIVER_FILTER = "__unassigned_driver__";

export function matchesBulkDeliveryScope(
  row: Pick<BulkDeliveryRow, "siteBranch" | "driverUserId">,
  branch: string,
  driverUserId: string,
) {
  return (
    (!branch || row.siteBranch === branch) &&
    (!driverUserId ||
      (driverUserId === UNASSIGNED_DRIVER_FILTER
        ? row.driverUserId === null
        : row.driverUserId === driverUserId))
  );
}

export function getBulkDeliveryEligibility(rows: BulkDeliveryRow[]) {
  const eligible = rows.filter(
    (row) => !row.actualDate && row.workflowStatus !== "closed",
  );
  return {
    eligible,
    excluded: rows.length - eligible.length,
    uniqueSites: new Set(eligible.map((row) => row.siteId)).size,
  };
}

export function buildBulkDeliveryUpdateInput(
  rows: BulkDeliveryRow[],
  change:
    | { operation: "driver"; driverUserId: string | null }
    | { operation: "date"; plannedDate: string },
) {
  const deliveries = rows.map((delivery) => ({
    id: delivery.id,
    expectedDriverUserId: delivery.driverUserId,
    expectedPlannedDate: delivery.plannedDate
      ? delivery.plannedDate.slice(0, 10)
      : null,
  }));
  return change.operation === "driver"
    ? { deliveries, driverUserId: change.driverUserId }
    : { deliveries, plannedDate: change.plannedDate };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkDeliveryRow[];
  drivers: DriverUser[];
  monthLabel: string;
  monthMin: string;
  monthMax: string;
  branchLabel?: string;
  driverLabel?: string;
  onSuccess: (updated: number) => void;
};

export function DeliveryBulkEditDialog({
  open,
  onOpenChange,
  rows,
  drivers,
  monthLabel,
  monthMin,
  monthMax,
  branchLabel,
  driverLabel,
  onSuccess,
}: Props) {
  const [operation, setOperation] = useState<"driver" | "date">("driver");
  const [driverUserId, setDriverUserId] = useState<string | null | undefined>(
    undefined,
  );
  const [plannedDate, setPlannedDate] = useState("");
  const [error, setError] = useState("");
  const { eligible, excluded, uniqueSites } = useMemo(
    () => getBulkDeliveryEligibility(rows),
    [rows],
  );

  useEffect(() => {
    if (!open) return;
    setOperation("driver");
    setDriverUserId(undefined);
    setPlannedDate("");
    setError("");
  }, [open]);

  const mutation = useUpdateDeliveriesBulk({
    mutation: {
      onSuccess: (result) => {
        onSuccess(result.updated);
        onOpenChange(false);
      },
      onError: (mutationError) => {
        setError(mutationError.message || "Не удалось изменить доставки");
      },
    },
  });

  const canSubmit =
    eligible.length > 0 &&
    eligible.length <= 5000 &&
    (operation === "driver"
      ? driverUserId !== undefined
      : Boolean(
          plannedDate &&
            plannedDate >= monthMin &&
            plannedDate <= monthMax,
        ));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || mutation.isPending) return;
    setError("");
    mutation.mutate({
      data: buildBulkDeliveryUpdateInput(
        eligible,
        operation === "driver"
          ? { operation, driverUserId: driverUserId ?? null }
          : { operation, plannedDate },
      ),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!mutation.isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Массовое изменение доставок</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p><strong>Месяц:</strong> {monthLabel}</p>
            {branchLabel && <p><strong>Куст:</strong> {branchLabel}</p>}
            {driverLabel && <p><strong>Водитель:</strong> {driverLabel}</p>}
            <p className="mt-2">
              Будут изменены <strong>{eligible.length}</strong> доставок по{" "}
              <strong>{uniqueSites}</strong> объектам.
            </p>
            <p className="text-muted-foreground">
              Учтены все текущие фильтры и все страницы списка.
            </p>
            <p className="mt-2 text-amber-700 dark:text-amber-300">
              Исключено: <strong>{excluded}</strong>. Завершённые и закрытые
              доставки нельзя изменять массово.
            </p>
          </div>

          {eligible.length > 5000 && (
            <Alert variant="destructive">
              <AlertDescription>
                Под фильтры попало {eligible.length} доступных доставок. За один
                раз можно изменить не более 5000 — уточните фильтры.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Что изменить</Label>
            <Select
              value={operation}
              onValueChange={(value) => {
                setOperation(value as "driver" | "date");
                setError("");
              }}
              disabled={mutation.isPending}
            >
              <SelectTrigger data-testid="bulk-operation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="driver">Назначить водителя</SelectItem>
                <SelectItem value="date">Изменить плановую дату</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {operation === "driver" ? (
            <div className="space-y-2">
              <Label>Новый водитель</Label>
              <Select
                value={
                  driverUserId === undefined
                    ? undefined
                    : driverUserId ?? "__unassigned__"
                }
                onValueChange={(value) =>
                  setDriverUserId(value === "__unassigned__" ? null : value)
                }
                disabled={mutation.isPending}
              >
                <SelectTrigger data-testid="bulk-driver">
                  <SelectValue placeholder="Выберите водителя" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">Не назначен</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name || driver.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Меняется водитель только у выбранных доставок. Закрепление
                водителя за объектом не изменится.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="bulk-planned-date">Новая плановая дата</Label>
              <Input
                id="bulk-planned-date"
                data-testid="bulk-planned-date"
                type="date"
                required
                min={monthMin}
                max={monthMax}
                value={plannedDate}
                onChange={(event) => setPlannedDate(event.target.value)}
                disabled={mutation.isPending}
              />
            </div>
          )}

          {error && (
            <Alert variant="destructive" data-testid="bulk-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || mutation.isPending}
              data-testid="bulk-confirm"
            >
              {mutation.isPending ? "Изменение…" : "Подтвердить изменение"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}