import { useParams } from "wouter";
import { useGetShipment } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

export default function ShipmentPrint() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id!;

  const { data: shipment, isLoading } = useGetShipment(shipmentId);

  if (isLoading || !shipment) {
    return <div className="p-8 text-muted-foreground">Загрузка...</div>;
  }

  if (shipment.isDeleted) {
    return (
      <div className="p-8 text-muted-foreground">
        Отгрузка помечена на удаление, накладная недоступна.
      </div>
    );
  }

  if (!shipment.isDispatched) {
    return (
      <div className="p-8 text-muted-foreground">
        Накладная доступна только после передачи отгрузки в доставку.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-3xl mx-auto p-8 print:p-0">
        <div className="flex justify-end mb-4 print:hidden">
          <Button onClick={() => window.print()} data-testid="button-print-invoice">
            <Printer className="h-4 w-4 mr-2" />
            Печать
          </Button>
        </div>

        <h1 className="text-xl font-bold text-center mb-1">Товарная накладная</h1>
        <p className="text-center text-sm mb-6">
          №{shipment.id.slice(0, 8)} от {dateFormatter.format(new Date(shipment.shipmentDate))}
        </p>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div>
            <div className="font-semibold">Клиент:</div>
            <div>{shipment.clientName}</div>
          </div>
          <div>
            <div className="font-semibold">Отгрузка №:</div>
            <div>{shipment.id.slice(0, 8)}</div>
          </div>
          <div>
            <div className="font-semibold">Заказ №:</div>
            <div>{shipment.orderNumber}</div>
          </div>
          <div>
            <div className="font-semibold">Объект доставки:</div>
            <div>{shipment.siteName}</div>
            <div className="text-xs">{shipment.siteAddress}</div>
          </div>
          <div>
            <div className="font-semibold">Водитель:</div>
            <div>{shipment.driver}</div>
          </div>
          <div>
            <div className="font-semibold">Дата отгрузки:</div>
            <div>{dateFormatter.format(new Date(shipment.shipmentDate))}</div>
          </div>
        </div>

        {shipment.note && (
          <div className="text-sm mb-6">
            <span className="font-semibold">Примечание: </span>
            {shipment.note}
          </div>
        )}

        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="text-left py-1.5 pr-2">№</th>
              <th className="text-left py-1.5 pr-2">Наименование товара</th>
              <th className="text-right py-1.5 pr-2">Ед. изм.</th>
              <th className="text-right py-1.5 pr-2">Кол-во</th>
              <th className="text-right py-1.5 pr-2">Цена</th>
              <th className="text-right py-1.5">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {shipment.items.map((item, index) => (
              <tr key={item.id} className="border-b border-gray-300">
                <td className="py-1.5 pr-2">{index + 1}</td>
                <td className="py-1.5 pr-2">{item.productName}</td>
                <td className="text-right py-1.5 pr-2">{item.productUnit}</td>
                <td className="text-right py-1.5 pr-2">{item.quantity}</td>
                <td className="text-right py-1.5 pr-2">{currency.format(item.price)}</td>
                <td className="text-right py-1.5">{currency.format(item.price * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="text-right font-semibold py-2 pr-2">
                Итого:
              </td>
              <td className="text-right font-semibold py-2">{currency.format(shipment.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="grid grid-cols-2 gap-8 text-sm mt-16">
          <div>
            <div className="mb-8">Отпустил: _____________________ / _____________________ /</div>
            <div className="text-xs">(должность, подпись)&emsp;&emsp;&emsp;&emsp;&emsp;(расшифровка подписи)</div>
          </div>
          <div>
            <div className="mb-8">Получил: _____________________ / _____________________ /</div>
            <div className="text-xs">(должность, подпись)&emsp;&emsp;&emsp;&emsp;&emsp;(расшифровка подписи)</div>
          </div>
        </div>

        <div className="mt-8 text-sm">М.П.</div>
      </div>
    </div>
  );
}
