import { deliveryProgressPercent, type DeliveryProgress } from "@/lib/delivery-progress";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function Metric({ title, value, plan, basis, tone = "", compact = false }: {
  title: string; value: number; plan: number; basis: string; tone?: string; compact?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 items-baseline rounded border bg-background py-1 ${compact ? "shrink-0 whitespace-nowrap gap-x-1 px-1.5 text-[11px]" : "flex-wrap gap-x-1.5 px-2 text-xs"} ${tone}`}
      title={plan > 0 ? basis : "Процент не рассчитан: план — 0"}
    >
      <span className="font-medium">{title}</span>
      <strong className="whitespace-nowrap tabular-nums">{value.toLocaleString("ru-RU")} шт.</strong>
      <span className="rounded bg-black/5 px-1 font-bold tabular-nums">{deliveryProgressPercent(value, plan)}</span>
    </div>
  );
}

const shortDate = (date: string) => date.split("-").reverse().join(".");

export function DeliveryProgressSummary({ summary }: { summary: DeliveryProgress }) {
  return (
    <div className="grid shrink-0 gap-2 xl:grid-cols-3" aria-label="План и факт доставок">
      <section className="min-w-0 rounded-md border bg-slate-50/70 px-2 py-1.5" data-testid="delivery-month-progress">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs">
          <h2 className="font-bold">Итоги месяца</h2>
          <span className="text-muted-foreground">% от плана месяца</span>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Как считаются итоги">
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="max-w-[calc(100vw-2rem)] space-y-2 text-xs">
              <p>План месяца — все доставки с назначенной датой. Выполнено и закрыто — нарастающим итогом к сегодня.</p>
              <p>Закрыто — акты подтверждены. Эти доставки уже входят в «Выполнено».</p>
              <p>За период — с 1-го числа по вчера включительно. Выполнено — по фактической дате, закрыто — из них с актами, согласованными на текущий момент, даже если согласование было позже периода. Проценты — от плана периода.</p>
              <p>Не выполнено за период — доставки по плану периода, не выполненные к его концу. Досрочные доставки из будущих дат не уменьшают этот показатель.</p>
              <p>За сегодня — план на текущую дату, выполнено по сегодняшней фактической дате, закрыто — из них с подтверждёнными актами. Проценты — от плана на сегодня. Даты определяются по Москве.</p>
              <p>Итоги не зависят от фильтров таблицы. При нулевом плане процент не рассчитывается (—).</p>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-nowrap gap-1 overflow-x-auto">
          <Metric compact title="План" value={summary.monthPlan} plan={summary.monthPlan} basis="100% — весь план месяца" />
          <Metric compact title="Выполнено" value={summary.done} plan={summary.monthPlan} basis="от общего плана месяца" tone="border-orange-200 text-orange-900" />
          <Metric compact title="Закрыто" value={summary.closed} plan={summary.monthPlan} basis="от общего плана месяца" tone="border-emerald-200 text-emerald-900" />
        </div>
      </section>
      <section className="min-w-0 rounded-md border border-blue-200 bg-blue-50/50 px-2 py-1.5" data-testid="delivery-period-progress">
        <div className="mb-1 flex min-h-5 flex-wrap items-center gap-x-2 text-xs">
          <h2 className="font-bold">За период</h2>
          <span className="text-muted-foreground">
            {summary.started ? `${shortDate(summary.start)} — ${shortDate(summary.through)}` : summary.periodEmptyLabel}
          </span>
          <span className="text-muted-foreground">% от плана периода</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Metric title="План" value={summary.periodPlan} plan={summary.periodPlan} basis="100% — план периода" tone="border-blue-200 text-blue-900" />
          <Metric title="Выполнено" value={summary.periodFact} plan={summary.periodPlan} basis="от плана за период" tone="border-orange-200 text-orange-900" />
          <Metric title="Закрыто" value={summary.periodClosed} plan={summary.periodPlan} basis="от плана за период" tone="border-emerald-200 text-emerald-900" />
          <Metric title="Не выполнено" value={summary.periodNotDone} plan={summary.periodPlan} basis="Не выполнены к концу периода; % от плана за период" tone="border-rose-200 text-rose-900" />
        </div>
      </section>
      <section className="min-w-0 rounded-md border border-violet-200 bg-violet-50/50 px-2 py-1.5" data-testid="delivery-today-progress">
        <div className="mb-1 flex min-h-5 flex-wrap items-center gap-x-2 text-xs">
          <h2 className="font-bold">За сегодня</h2>
          <span className="text-muted-foreground">{shortDate(summary.today)}</span>
          <span className="text-muted-foreground">% от плана на сегодня</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Metric title="План" value={summary.todayPlan} plan={summary.todayPlan} basis="100% — план на сегодня" tone="border-violet-200 text-violet-900" />
          <Metric title="Выполнено" value={summary.todayFact} plan={summary.todayPlan} basis="от плана на сегодня" tone="border-orange-200 text-orange-900" />
          <Metric title="Закрыто" value={summary.todayClosed} plan={summary.todayPlan} basis="от плана на сегодня" tone="border-emerald-200 text-emerald-900" />
        </div>
        {!summary.todayActive && <p className="mt-1 text-[11px] text-muted-foreground">Сегодня вне выбранного месяца</p>}
      </section>
    </div>
  );
}