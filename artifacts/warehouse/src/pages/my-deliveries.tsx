import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyDeliveries,
  useMarkMyDeliveryDone,
  getListMyDeliveriesQueryKey,
} from "@workspace/api-client-react";
import type { Delivery } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, MapPin, Camera, Loader2,
  ChevronLeft, ChevronRight, Search, Calendar, Edit2, AlertCircle, Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { DeliveryPhotosDialog } from "@/components/delivery-photos-dialog";
import { DeliveryCommentDialog } from "@/components/delivery-comment-dialog";
import { cn } from "@/lib/utils";

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const todayStr = isoDate(new Date());

function moveDay(current: string, delta: number): string {
  const d = new Date(current);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

function FilterChip({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

function StatusBadge({ delivery, isOverdue }: { delivery: Delivery, isOverdue: boolean }) {
  if (delivery.workflowStatus === "closed") {
    return <Badge className="shrink-0 bg-emerald-600 hover:bg-emerald-600">Закрыто</Badge>;
  }
  if (delivery.workflowStatus === "done") {
    return <Badge className="shrink-0 bg-orange-500 hover:bg-orange-500">Выполнено</Badge>;
  }
  if (isOverdue) {
    return <Badge variant="destructive" className="shrink-0">Просрочено</Badge>;
  }
  return <Badge variant="secondary" className="shrink-0 text-slate-700">План</Badge>;
}

export default function MyDeliveries() {
  const { user } = usePermissions();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "planned" | "done" | "closed" | "not_completed">("all");

  const [photosDelivery, setPhotosDelivery] = useState<Delivery | null>(null);
  const [commentDelivery, setCommentDelivery] = useState<Delivery | null>(null);

  const {
    data: deliveries,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useListMyDeliveries({
    from: selectedDate,
    to: selectedDate,
    search: search.trim().length > 0 ? search.trim() : undefined,
  });

  const isToday = selectedDate === todayStr;

  const { counts, filtered } = useMemo(() => {
    const list = deliveries ?? [];
    const c = { planned: 0, done: 0, closed: 0, not_completed: 0 };
    const f = [];

    for (const d of list) {
      let cat: "planned" | "done" | "closed" | "not_completed" = "planned";

      if (d.workflowStatus === "closed") {
        c.closed++;
        cat = "closed";
      } else if (d.workflowStatus === "done") {
        c.done++;
        cat = "done";
      } else {
        const isOverdue = d.plannedDate !== null && d.plannedDate < todayStr;
        if (isOverdue) {
          c.not_completed++;
          cat = "not_completed";
        } else {
          c.planned++;
          cat = "planned";
        }
      }

      if (activeFilter === "all" || activeFilter === cat) {
        f.push(d);
      }
    }

    f.sort((a, b) => {
      const aDone = !!a.actualDate ? 1 : 0;
      const bDone = !!b.actualDate ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return a.siteName.localeCompare(b.siteName);
    });

    return { counts: c, filtered: f };
  }, [deliveries, activeFilter, todayStr]);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const markDone = useMarkMyDeliveryDone({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMyDeliveriesQueryKey() });
        toast({ title: "Доставка отмечена выполненной" });
      },
      onError: (err: any) => {
        toast({ title: "Ошибка", description: err.response?.data?.error ?? err.message, variant: "destructive" });
      }
    }
  });

  return (
    <div
      data-testid="my-deliveries-page"
      className="mx-auto w-full min-w-0 max-w-lg overflow-x-hidden pb-12"
    >
      {/* Header section with date and search */}
      <div className="bg-[#f5ecd9] px-4 py-4 rounded-b-3xl shadow-sm mb-4 space-y-4">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2 min-w-0 break-words">
          <Calendar className="h-6 w-6 text-orange-600 shrink-0" />
          Мои доставки {user?.name ? <span className="opacity-70 font-normal truncate">— {user.name}</span> : ""}
        </h1>

        <div className="flex items-center justify-between bg-white rounded-2xl shadow-sm p-1">
          <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 rounded-xl" onClick={() => setSelectedDate(moveDay(selectedDate, -1))}>
            <ChevronLeft className="h-6 w-6 text-slate-600" />
          </Button>
          <div className="flex flex-col items-center">
            <input
              type="date"
              value={selectedDate}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className="bg-transparent border-none text-[17px] font-bold text-center outline-none w-[140px] p-0 text-slate-900"
            />
            {isToday && <span className="text-[10px] uppercase font-extrabold text-orange-600 tracking-wider">Сегодня</span>}
          </div>
          <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 rounded-xl" onClick={() => setSelectedDate(moveDay(selectedDate, 1))}>
            <ChevronRight className="h-6 w-6 text-slate-600" />
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Поиск по объекту или адресу..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-11 h-12 text-base rounded-2xl bg-white/90 border-white focus:bg-white shadow-sm transition-colors placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 mb-4">
        <div className="flex flex-wrap gap-2">
          <FilterChip active={activeFilter === 'all'} onClick={() => setActiveFilter('all')}>
            Все
          </FilterChip>
          <FilterChip active={activeFilter === 'planned'} onClick={() => setActiveFilter('planned')}>
            {isToday ? "План на сегодня" : "План"}
            <span className={cn("px-1.5 py-0.5 rounded-full text-[10px]", activeFilter === 'planned' ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500")}>{counts.planned}</span>
          </FilterChip>
          <FilterChip active={activeFilter === 'not_completed'} onClick={() => setActiveFilter('not_completed')}>
            Не выполнено
            <span className={cn("px-1.5 py-0.5 rounded-full text-[10px]", activeFilter === 'not_completed' ? "bg-white/20 text-white" : "bg-rose-100 text-rose-600")}>{counts.not_completed}</span>
          </FilterChip>
          <FilterChip active={activeFilter === 'done'} onClick={() => setActiveFilter('done')}>
            Выполнено
            <span className={cn("px-1.5 py-0.5 rounded-full text-[10px]", activeFilter === 'done' ? "bg-white/20 text-white" : "bg-orange-100 text-orange-700")}>{counts.done}</span>
          </FilterChip>
          <FilterChip active={activeFilter === 'closed'} onClick={() => setActiveFilter('closed')}>
            Закрыто
            <span className={cn("px-1.5 py-0.5 rounded-full text-[10px]", activeFilter === 'closed' ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700")}>{counts.closed}</span>
          </FilterChip>
        </div>
      </div>

      {/* List */}
      <div className="px-4 space-y-4">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="h-10 w-10 animate-spin mb-3 opacity-50" />
            <p className="text-[15px] font-medium">Загрузка...</p>
          </div>
        ) : isError ? (
          <div className="py-12 flex flex-col items-center justify-center text-center px-5 bg-rose-50 rounded-3xl border border-rose-200">
            <AlertCircle className="h-12 w-12 mb-3 text-rose-500" />
            <p className="text-[17px] font-semibold text-rose-800">
              Не удалось загрузить доставки
            </p>
            <p className="text-[15px] mt-1 mb-5 text-rose-700">
              Проверьте подключение и попробуйте ещё раз.
            </p>
            <Button
              type="button"
              variant="outline"
              className="bg-white border-rose-300 text-rose-800 hover:bg-rose-100"
              disabled={isFetching}
              onClick={() => refetch()}
            >
              {isFetching && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Загрузить снова
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400 text-center px-4 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
            <AlertCircle className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-[17px] font-semibold text-slate-600">Нет доставок</p>
            <p className="text-[15px] mt-1">По вашему запросу ничего не найдено на выбранную дату.</p>
          </div>
        ) : (
          filtered.map(d => {
            const isOverdue = d.plannedDate !== null && d.plannedDate < todayStr;
            let toneBorderColor = "border-slate-200";
            if (d.workflowStatus === "closed") toneBorderColor = "border-emerald-500 bg-emerald-50/30";
            else if (d.workflowStatus === "done") toneBorderColor = "border-orange-500 bg-orange-50/30";
            else if (isOverdue) toneBorderColor = "border-rose-400 bg-rose-50/30";

            return (
              <Card
                key={d.id}
                data-testid={`delivery-card-${d.id}`}
                className={cn("min-w-0 shadow-sm overflow-hidden border-l-[5px] rounded-2xl", toneBorderColor)}
              >
                <div className="p-4 sm:p-5">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3
                      data-testid={`delivery-site-name-${d.id}`}
                      className="min-w-0 break-words [overflow-wrap:anywhere] font-bold text-[18px] leading-tight text-slate-900"
                    >
                      {d.siteName}
                    </h3>
                    <StatusBadge delivery={d} isOverdue={isOverdue} />
                  </div>

                  <div className="mb-3 flex min-w-0 items-start gap-2 text-[15px] text-slate-600">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{d.siteAddress}</span>
                  </div>

                  <div className="bg-white/80 border border-slate-100 rounded-xl p-3.5 mb-4 shadow-sm">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Комментарий</span>
                      {d.workflowStatus !== "closed" && (
                        <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs font-semibold text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg" onClick={() => setCommentDelivery(d)}>
                          <Edit2 className="h-3 w-3 mr-1.5" /> {d.note ? "Изменить" : "Написать"}
                        </Button>
                      )}
                    </div>
                    {d.note ? (
                      <div
                        data-testid={`delivery-note-${d.id}`}
                        className="min-w-0 break-words [overflow-wrap:anywhere] whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800"
                      >
                        {d.note}
                      </div>
                    ) : (
                      <div className="text-[14px] text-slate-400 italic">Нет комментария</div>
                    )}
                  </div>

                  <div className="flex min-w-0 gap-2">
                    {!d.actualDate && (
                      <Button
                        className="h-14 min-w-0 flex-1 rounded-xl bg-emerald-600 px-2 text-[16px] font-bold shadow-sm hover:bg-emerald-700"
                        onClick={() => markDone.mutate({ id: d.id })}
                        disabled={markDone.isPending}
                        data-testid={`button-mark-done-${d.id}`}
                      >
                        {markDone.isPending ? <Loader2 className="animate-spin h-6 w-6" /> : <Check className="h-6 w-6 mr-1.5" />}
                        Выполнено
                      </Button>
                    )}
                    <Button
                      variant={d.photosCount > 0 ? "secondary" : "outline"}
                      className={cn("h-14 min-w-0 px-2 text-[16px] font-bold rounded-xl shadow-sm", !d.actualDate ? "flex-1" : "w-full border-slate-300 bg-white")}
                      onClick={() => setPhotosDelivery(d)}
                      data-testid={`button-acts-${d.id}`}
                    >
                      <Camera className={cn("h-6 w-6 mr-2", d.photosCount > 0 ? "text-slate-800" : "text-slate-500")} />
                      Акты {d.photosCount > 0 && <Badge className="ml-2 px-2 py-0.5 text-xs bg-white text-slate-900 rounded-full shadow-sm">{d.photosCount}</Badge>}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <DeliveryPhotosDialog
        delivery={photosDelivery}
        open={!!photosDelivery}
        onOpenChange={(open) => !open && setPhotosDelivery(null)}
        canEdit={true}
        canDelete={false}
      />

      <DeliveryCommentDialog
        delivery={commentDelivery}
        open={!!commentDelivery}
        onOpenChange={(open) => !open && setCommentDelivery(null)}
      />
    </div>
  );
}
