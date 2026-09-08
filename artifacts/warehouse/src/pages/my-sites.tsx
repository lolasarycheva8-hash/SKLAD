import { useState } from "react";
import {
  useGetMySitesSummary,
  useListMyDeliveries,
  getListMyDeliveriesQueryKey,
} from "@workspace/api-client-react";
import type { MySiteSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Truck } from "lucide-react";

type Period = "today" | "week" | "month";

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeFor(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = isoDate(now);
  if (period === "today") return { from: today, to: today };
  const start = new Date(now);
  const end = new Date(now);
  if (period === "week") {
    start.setDate(start.getDate() - 3);
    end.setDate(end.getDate() + 7);
  } else {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  }
  return { from: isoDate(start), to: isoDate(end) };
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "Сегодня",
  week: "Неделя",
  month: "Месяц",
};

function formatRu(dateStr: string | null): string {
  if (!dateStr) return "Нет даты";
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function SiteCard({
  site,
  range,
}: {
  site: MySiteSummary;
  range: { from: string; to: string };
}) {
  const [open, setOpen] = useState(false);
  const params = { siteId: site.siteId, from: range.from, to: range.to };
  const { data: deliveries, isLoading } = useListMyDeliveries(params, {
    query: {
      enabled: open,
      queryKey: getListMyDeliveriesQueryKey(params),
    },
  });

  return (
    <Card data-testid={`card-my-site-${site.siteId}`}>
      <CardContent className="p-4 space-y-2">
        <button
          className="w-full text-left"
          onClick={() => setOpen((v) => !v)}
          data-testid={`button-toggle-site-${site.siteId}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">{site.siteName}</div>
              <div className="text-sm text-muted-foreground">{site.address}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <Truck className="h-4 w-4" /> {site.driver}
              </div>
            </div>
            {open ? (
              <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
            )}
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge variant="secondary">План: {site.planned}</Badge>
            <Badge className="bg-green-600">Факт: {site.done}</Badge>
            {site.overdue > 0 && (
              <Badge variant="destructive">Просрочено: {site.overdue}</Badge>
            )}
          </div>
        </button>

        {open && (
          <div className="pt-2 border-t space-y-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : (deliveries ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет доставок за период</p>
            ) : (
              (deliveries ?? []).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between text-sm gap-2"
                  data-testid={`row-site-delivery-${d.id}`}
                >
                  <span>
                    {formatRu(d.plannedDate)}
                    {d.note ? ` · ${d.note}` : ""}
                  </span>
                  {d.actualDate ? (
                    <Badge className="bg-green-600 shrink-0">
                      {formatRu(d.actualDate)}
                    </Badge>
                  ) : d.status === "overdue" ? (
                    <Badge variant="destructive" className="shrink-0">Просрочено</Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">План</Badge>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MySites() {
  const [period, setPeriod] = useState<Period>("week");
  const range = rangeFor(period);

  const { data: sites, isLoading } = useGetMySitesSummary({
    from: range.from,
    to: range.to,
  });

  const totals = (sites ?? []).reduce(
    (acc, s) => ({
      planned: acc.planned + s.planned,
      done: acc.done + s.done,
      overdue: acc.overdue + s.overdue,
    }),
    { planned: 0, done: 0, overdue: 0 },
  );

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <h1
        className="text-xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2"
        data-testid="text-page-title"
      >
        Мои объекты
      </h1>

      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <Button
            key={p}
            variant={period === p ? "default" : "outline"}
            className="h-10"
            onClick={() => setPeriod(p)}
            data-testid={`button-period-${p}`}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>

      {!isLoading && (sites ?? []).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Badge variant="secondary" className="text-sm">План: {totals.planned}</Badge>
          <Badge className="bg-green-600 text-sm">Факт: {totals.done}</Badge>
          {totals.overdue > 0 && (
            <Badge variant="destructive" className="text-sm">
              Просрочено: {totals.overdue}
            </Badge>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Загрузка...</p>
      ) : (sites ?? []).length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          За вами пока не закреплены объекты. Обратитесь к администратору.
        </p>
      ) : (
        <div className="space-y-3">
          {(sites ?? []).map((s) => (
            <SiteCard key={s.siteId} site={s} range={range} />
          ))}
        </div>
      )}
    </div>
  );
}
