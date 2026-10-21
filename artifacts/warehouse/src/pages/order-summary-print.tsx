import { useParams } from "wouter";
import { useGetOrderSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { SELLER_NAME, SUMMARY_STATUS_LABELS, apiErrorMessage, formatPeriod } from "@/lib/order-status";

const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function OrderSummaryPrint() {
  const { id } = useParams<{ id: string }>();
  const { data: s, isLoading, isError, error } = useGetOrderSummary(id!);
  if (isLoading) return <div className="p-8 text-muted-foreground">Загрузка...</div>;
  if (isError || !s) return <div className="p-8 text-destructive">Не удалось загрузить итоговый заказ: {apiErrorMessage(error)}</div>;

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-3xl mx-auto p-8 print:p-0">
        <div className="flex justify-end mb-4 print:hidden">
          <Button onClick={() => window.print()} data-testid="button-print-summary"><Printer className="h-4 w-4 mr-2" />Печать</Button>
        </div>
        <h1 className="text-xl font-bold text-center mb-1">Итоговый заказ № {s.number}</h1>
        <p className="text-center text-sm mb-6">от {dateFormatter.format(new Date(s.createdAt))}, период: {formatPeriod(s.periodFrom, s.periodTo)}</p>
        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div><div className="font-semibold">Поставщик:</div><div>{SELLER_NAME}</div></div>
          <div><div className="font-semibold">Клиент:</div><div>{s.clientName}</div></div>
          <div><div className="font-semibold">Статус оплаты:</div><div>{SUMMARY_STATUS_LABELS[s.status]}</div></div>
          <div><div className="font-semibold">Заказы:</div><div>{s.orders.map((o) => `№${o.number}`).join(", ")}</div></div>
        </div>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 text-left">№</th>
              <th className="border border-black px-2 py-1 text-left">Товар</th>
              <th className="border border-black px-2 py-1">Ед.</th>
              <th className="border border-black px-2 py-1 text-right">Кол-во</th>
              <th className="border border-black px-2 py-1 text-right">Цена</th>
              <th className="border border-black px-2 py-1 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((it, i) => (
              <tr key={`${it.productId}-${it.price}`}>
                <td className="border border-black px-2 py-1">{i + 1}</td>
                <td className="border border-black px-2 py-1">{it.productName}</td>
                <td className="border border-black px-2 py-1 text-center">{it.unit}</td>
                <td className="border border-black px-2 py-1 text-right">{it.quantity}</td>
                <td className="border border-black px-2 py-1 text-right">{currency.format(it.price)}</td>
                <td className="border border-black px-2 py-1 text-right">{currency.format(it.total)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1 text-right font-semibold">Итого</td>
              <td className="border border-black px-2 py-1 text-right font-semibold">{currency.format(s.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div>Поставщик ({SELLER_NAME}): ____________________</div>
          <div>Клиент: ____________________</div>
        </div>
      </div>
    </div>
  );
}
