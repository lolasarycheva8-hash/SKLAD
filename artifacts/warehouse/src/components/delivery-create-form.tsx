import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  type DeliverySiteLookup, 
  type DriverUser, 
  type CreateDeliveryInput,
   useListDeliveryTypeLookup,
   getListDeliveryTypeLookupQueryKey
} from "@workspace/api-client-react";
import { getMonthDateBounds } from "@/lib/delivery-workspace";

import { 
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

function todayLocalISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24));
}

function computeLag(plannedDate: string | null, actualDate: string | null): number | null {
  if (!plannedDate) return null;
  if (actualDate) {
    return daysBetween(plannedDate, actualDate);
  }
  const today = todayLocalISO();
  if (plannedDate < today) {
    return daysBetween(plannedDate, today);
  }
  return null;
}

export interface DeliveryCreateFormProps {
  sites: DeliverySiteLookup[];
  drivers: DriverUser[];
  month: string;
  isPending: boolean;
  onSubmit: (item: CreateDeliveryInput) => void;
  onCancel: () => void;
}

export function DeliveryCreateForm({
  sites,
  drivers,
  month,
  isPending,
  onSubmit,
  onCancel,
}: DeliveryCreateFormProps) {
  const { min: minDate, max: maxDate } = getMonthDateBounds(month);

  const {
    data: deliveryTypes,
    isPending: dtPending,
    isError: dtError,
    refetch: dtRefetch,
  } = useListDeliveryTypeLookup({
    query: { queryKey: getListDeliveryTypeLookupQueryKey() },
  });

  const activeSites = useMemo(() => sites.filter((s) => !s.isClosed), [sites]);
  const defaultSite = activeSites.length > 0 ? activeSites[0] : null;

  const formSchema = z
    .object({
      siteId: z.string().min(1, "Выберите объект"),
      driverUserId: z.string().refine((val) => val !== "none", "Назначьте водителя"),
      deliveryType: z.string().optional(),
      plannedDate: z.string().optional(),
      actualDate: z.string().optional(),
      correctedPlannedDate: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.actualDate && !data.plannedDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Факт. дата требует плановую",
          path: ["actualDate"],
        });
      }
      if (data.correctedPlannedDate && !data.plannedDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Скорректированная дата требует плановую",
          path: ["correctedPlannedDate"],
        });
      }
    });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      siteId: defaultSite?.id || "",
      driverUserId: defaultSite?.driverUserId || "none",
      deliveryType: defaultSite?.deliveryType || "none",
      plannedDate: "",
      actualDate: "",
      correctedPlannedDate: "",
    },
  });

  const siteId = form.watch("siteId");
  const site = sites.find((s) => s.id === siteId);

  const handleSiteChange = (newSiteId: string) => {
    form.setValue("siteId", newSiteId);
    const newSite = sites.find((s) => s.id === newSiteId);
    if (newSite) {
      form.setValue("driverUserId", newSite.driverUserId || "none");
      form.setValue("deliveryType", newSite.deliveryType || "none");
    }
  };

  const plannedDate = form.watch("plannedDate");
  const actualDate = form.watch("actualDate");
  const lagDays = computeLag(plannedDate || null, actualDate || null);

  const handleSubmit = form.handleSubmit((values) => {
    if (!site || isPending) return;
    const dt = values.deliveryType === "none" ? "" : values.deliveryType || "";
    const finalDeliveryType = !dt || dt === (site.deliveryType || "") ? null : dt;

    onSubmit({
      siteId: values.siteId,
      driverUserId: values.driverUserId,
      plannedDate: values.plannedDate || null,
      scheduleMonth: month,
      deliveryType: finalDeliveryType,
      actualDate: values.actualDate || null,
      correctedPlannedDate: values.correctedPlannedDate || null,
    });
  });

  const currentDt = form.watch("deliveryType");
  const dtOptions = useMemo(() => {
    const list = (deliveryTypes || []).map((d) => d.name);
    if (currentDt && currentDt !== "none" && !list.includes(currentDt)) {
      return [...list, currentDt];
    }
    return list;
  }, [deliveryTypes, currentDt]);

  const isDriverNone = form.watch("driverUserId") === "none";

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 space-y-4">
          <p className="text-xs text-muted-foreground">
            Данные объекта подставляются автоматически. Водитель и тип поставки
            меняются только для этой доставки.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="siteId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Объект</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={handleSiteChange}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-create-site" aria-label="Объект">
                        <SelectValue placeholder="Выберите объект" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeSites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="driverUserId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Водитель</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-create-driver" aria-label="Водитель">
                        <SelectValue placeholder="Назначьте водителя" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Не назначен</SelectItem>
                      {drivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name || d.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.value === "none" && (
                    <p className="text-[0.8rem] font-medium text-destructive">
                      Назначьте водителя для создания доставки
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>Адрес</Label>
              <Input
                readOnly
                value={site?.address || ""}
                disabled
                data-testid="input-create-address"
                aria-label="Адрес"
              />
            </div>

            <div className="space-y-2">
              <Label>Куст</Label>
              <Input
                readOnly
                value={site?.branch || ""}
                disabled
                data-testid="input-create-branch"
                aria-label="Куст"
              />
            </div>

            <FormField
              control={form.control}
              name="deliveryType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип поставки</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isPending || dtPending}
                  >
                    <FormControl>
                      <SelectTrigger
                        data-testid="select-create-delivery-type"
                        aria-label="Тип поставки"
                      >
                        <SelectValue
                          placeholder={dtPending ? "Загрузка..." : "Выберите тип"}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Как в объекте{site?.deliveryType ? `: ${site.deliveryType}` : " (не задан)"}</SelectItem>
                      {dtOptions.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {dtError && (
                    <div className="flex items-center gap-2 mt-1 text-sm text-destructive">
                      <span>Ошибка загрузки</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => dtRefetch()}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> Повторить
                      </Button>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>Менеджер</Label>
              <Input
                readOnly
                value={site?.manager || ""}
                disabled
                data-testid="input-create-manager"
                aria-label="Менеджер"
              />
            </div>

            <FormField
              control={form.control}
              name="plannedDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>План дата</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      min={minDate}
                      max={maxDate}
                      disabled={isPending}
                      data-testid="input-create-planned-date"
                      aria-label="План дата"
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="correctedPlannedDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ДатаПланКорр</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      disabled={isPending}
                      data-testid="input-create-corrected-date"
                      aria-label="Скорректированная дата"
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">
                    Только для информации: график и просрочка считаются по исходному плану.
                  </p>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="actualDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Факт дата</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      min={minDate}
                      max={maxDate}
                      disabled={isPending}
                      data-testid="input-create-actual-date"
                      aria-label="Фактическая дата"
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>Отклонение</Label>
              <Input
                readOnly
                value={lagDays !== null ? lagDays : ""}
                disabled
                data-testid="output-create-lag"
                aria-label="Отклонение"
              />
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Особенности</Label>
              <Textarea
                readOnly
                value={site?.features || ""}
                disabled
                className="resize-none min-h-[60px]"
                data-testid="input-create-features"
                aria-label="Особенности"
              />
            </div>

            <div className="space-y-2">
              <Label>Примечание логиста</Label>
              <Textarea
                readOnly
                placeholder="Заполняется логистом после создания"
                disabled
                className="resize-none h-[60px]"
                data-testid="input-create-logistician-note"
                aria-label="Примечание логиста"
              />
            </div>

            <div className="space-y-2">
              <Label>Комментарий водителя</Label>
              <Textarea
                readOnly
                placeholder="Заполняется водителем"
                disabled
                className="resize-none h-[60px]"
                data-testid="input-create-driver-note"
                aria-label="Комментарий водителя"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Акт можно загрузить после создания доставки.</p>
        </div>

        <div className="flex shrink-0 justify-end gap-2 pt-2 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={isPending || isDriverNone || !site}
            data-testid="button-submit-create-delivery"
          >
            {isPending ? "Добавление..." : "Добавить"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
