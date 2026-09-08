import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDashboardSummary,
  useGetDeliveryDashboardSummary,
  useListOrders,
  useUpdateDelivery,
  getGetDeliveryDashboardSummaryQueryKey,
  getListDeliveriesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import {
  AlertTriangle,
  Truck,
  TrendingDown,
  Percent,
  CalendarCheck,
  CalendarClock,
  Wallet,
  Hourglass,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Check,
  X,
} from "lucide-react";

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: deliverySummary, isLoading: isDeliveryLoading } = useGetDeliveryDashboardSummary({
    month: currentMonthValue(),
  });
  const { data: orders, isLoading: isOrdersLoading } = useListOrders();
  const { canEdit } = usePermissions();
  const canEditDeliveries = canEdit("deliveries");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const month = currentMonthValue();
  const monthOrders = (orders ?? []).filter((order) => order.createdAt.slice(0, 7) === month);
  const monthOrdersTotal = monthOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const monthPaidTotal = monthOrders
    .filter((order) => order.isPaid)
    .reduce((sum, order) => sum + order.totalAmount, 0);
  const unpaidOrders = (orders ?? [])
    .filter((order) => !order.isPaid)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full" data-testid="text-page-title">
          Сводный отчет
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Обзор складских остатков и движений
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/deliveries?period=day" data-testid="link-today-plan">
          <Card data-testid="stat-today-plan" className="cursor-pointer transition-colors hover:bg-accent/50 h-full">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Сегодня план</p>
                  {isDeliveryLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold mt-1">{deliverySummary?.todayTotal ?? 0}</p>
                  )}
                </div>
                <div className="h-10 w-10 rounded-md flex items-center justify-center bg-primary/10 text-primary">
                  <CalendarCheck className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/deliveries?status=overdue" data-testid="link-overdue-undelivered">
          <Card data-testid="stat-overdue-undelivered" className="cursor-pointer transition-colors hover:bg-accent/50 h-full">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Просрочено — не доставлено</p>
                  {isDeliveryLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p
                      className={`text-2xl font-bold mt-1 ${
                        (deliverySummary?.overdueCount ?? 0) > 0 ? "text-destructive" : ""
                      }`}
                    >
                      {deliverySummary?.overdueCount ?? 0}
                    </p>
                  )}
                </div>
                <div className="h-10 w-10 rounded-md flex items-center justify-center bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link
          href={`/deliveries?month=${month}&view=undated`}
          data-testid="link-undated-deliveries"
        >
          <Card
            data-testid="stat-undated-deliveries"
            className={`cursor-pointer transition-colors hover:bg-amber-50 h-full ${
              (deliverySummary?.undatedCount ?? 0) > 0
                ? "border-amber-500 bg-amber-50/60"
                : ""
            }`}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Дата не назначена</p>
                  {isDeliveryLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p
                      className={`text-2xl font-bold mt-1 ${
                        (deliverySummary?.undatedCount ?? 0) > 0 ? "text-amber-700" : ""
                      }`}
                    >
                      {deliverySummary?.undatedCount ?? 0}
                    </p>
                  )}
                </div>
                <div className="h-10 w-10 rounded-md flex items-center justify-center bg-amber-100 text-amber-700">
                  <CalendarClock className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/products?lowStock=1" data-testid="link-low-stock">
          <Card
            className={`cursor-pointer transition-colors hover:bg-accent/50 h-full ${
              (summary?.lowStockCount ?? 0) > 0 ? "border-destructive/40" : ""
            }`}
            data-testid="stat-low-stock"
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Мало на складе</p>
                  {isLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p
                      className={`text-2xl font-bold mt-1 ${
                        (summary?.lowStockCount ?? 0) > 0 ? "text-destructive" : ""
                      }`}
                    >
                      {summary?.lowStockCount ?? 0}
                    </p>
                  )}
                </div>
                <div
                  className={`h-10 w-10 rounded-md flex items-center justify-center ${
                    (summary?.lowStockCount ?? 0) > 0
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Заказы за текущий месяц ({month})</h2>
        <div className="space-y-4">
          <Card data-testid="stat-month-orders-summary">
            <CardContent className="pt-6">
              {isOrdersLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : (
                <div className="divide-y">
                  <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-md flex items-center justify-center bg-primary/10 text-primary shrink-0">
                        <Wallet className="h-4 w-4" />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">Сумма выставленных заказов</p>
                    </div>
                    <span className="text-lg font-bold text-foreground whitespace-nowrap">
                      {currency.format(monthOrdersTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-md flex items-center justify-center bg-green-100 text-green-800 shrink-0">
                        <CreditCard className="h-4 w-4" />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">Сумма оплаченных заказов</p>
                    </div>
                    <span className="text-lg font-bold text-foreground whitespace-nowrap">
                      {currency.format(monthPaidTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-md flex items-center justify-center bg-amber-100 text-amber-700 shrink-0">
                        <Hourglass className="h-4 w-4" />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">Ожидается оплата</p>
                    </div>
                    <span
                      className="text-lg font-bold text-amber-600 whitespace-nowrap"
                      data-testid="text-month-orders-pending"
                    >
                      {currency.format(Math.max(monthOrdersTotal - monthPaidTotal, 0))}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div>
            <Card className="h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">Заказы, ожидающие оплаты</CardTitle>
                <Link href="/orders" className="text-sm text-primary hover:underline" data-testid="link-view-all-orders">
                  Все заказы
                </Link>
              </CardHeader>
              <CardContent>
                {isOrdersLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : unpaidOrders.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Клиент</TableHead>
                        <TableHead>Создан</TableHead>
                        <TableHead className="text-right">Сумма</TableHead>
                        <TableHead className="w-24"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unpaidOrders.map((order) => (
                        <TableRow key={order.id} data-testid={`row-unpaid-order-${order.id}`}>
                          <TableCell className="font-medium">{order.clientName}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {dateFormatter.format(new Date(order.createdAt))}
                          </TableCell>
                          <TableCell className="text-right">{currency.format(order.totalAmount)}</TableCell>
                          <TableCell>
                            <Link href={`/orders/${order.id}`}>
                              <Button variant="outline" size="sm" data-testid={`button-open-unpaid-order-${order.id}`}>
                                Открыть
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    Заказов, ожидающих оплаты, нет
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">План-факт по доставкам ({currentMonthValue()})</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="stat-plan-fact-percent">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">План-факт, %</p>
                  {isDeliveryLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold mt-1">
                      {deliverySummary ? `${deliverySummary.planFactPercent.toFixed(0)}%` : "—"}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {deliverySummary
                      ? `${deliverySummary.onTimeCount} из ${deliverySummary.dueCount} в срок`
                      : ""}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-md flex items-center justify-center bg-primary/10 text-primary">
                  <Percent className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="stat-scheduled">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Запланировано доставок</p>
                  {isDeliveryLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold mt-1">{deliverySummary?.totalScheduled ?? 0}</p>
                  )}
                </div>
                <div className="h-10 w-10 rounded-md flex items-center justify-center bg-primary/10 text-primary">
                  <Truck className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="stat-overdue">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Отставание от графика</p>
                  {isDeliveryLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p
                      className={`text-2xl font-bold mt-1 ${
                        (deliverySummary?.overdueCount ?? 0) > 0 ? "text-destructive" : ""
                      }`}
                    >
                      {deliverySummary?.overdueCount ?? 0}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">просроченных доставок</p>
                </div>
                <div
                  className={`h-10 w-10 rounded-md flex items-center justify-center ${
                    (deliverySummary?.overdueCount ?? 0) > 0
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="stat-avg-lag">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Среднее отклонение</p>
                  {isDeliveryLoading ? (
                    <Skeleton className="h-7 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold mt-1">
                      {deliverySummary ? `${deliverySummary.avgLagDays.toFixed(1)} дн.` : "—"}
                    </p>
                  )}
                </div>
                <div className="h-10 w-10 rounded-md flex items-center justify-center bg-primary/10 text-primary">
                  <TrendingDown className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>План-факт по водителям (за текущий месяц)</CardTitle>
            <Link href="/deliveries" className="text-sm text-primary hover:underline" data-testid="link-view-all-deliveries">
              График доставок
            </Link>
          </CardHeader>
          <CardContent>
            {isDeliveryLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : deliverySummary && deliverySummary.planFactByDriver.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Водитель</TableHead>
                    <TableHead className="text-right">В срок</TableHead>
                    <TableHead className="text-right">Всего</TableHead>
                    <TableHead className="text-right">План-факт</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliverySummary.planFactByDriver.map((stat) => (
                    <TableRow key={stat.driver} data-testid={`row-driver-stat-${stat.driver}`}>
                      <TableCell className="font-medium">{stat.driver}</TableCell>
                      <TableCell className="text-right">{stat.onTime}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{stat.total}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={stat.planFactPercent >= 90 ? "default" : "secondary"}>
                          {stat.planFactPercent.toFixed(0)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Нет данных по доставкам за этот месяц
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Просроченные доставки</CardTitle>
            <Link href="/deliveries" className="text-sm text-primary hover:underline" data-testid="link-view-overdue-deliveries">
              Все доставки
            </Link>
          </CardHeader>
          <CardContent>
            {isDeliveryLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : deliverySummary && deliverySummary.overdueDeliveries.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Объект</TableHead>
                    <TableHead>Водитель</TableHead>
                    <TableHead className="text-right">Отставание</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliverySummary.overdueDeliveries.map((delivery) => (
                    <TableRow key={delivery.id} data-testid={`row-overdue-${delivery.id}`}>
                      <TableCell className="font-medium">{delivery.siteName}</TableCell>
                      <TableCell className="text-muted-foreground">{delivery.driver}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive">{delivery.lagDays} дн.</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Просроченных доставок нет
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
