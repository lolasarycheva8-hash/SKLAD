import { useParams } from "wouter";
import { useGetGoodsReceipt } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

export default function GoodsReceiptPrint() {
  const params = useParams<{ id: string }>();
  const receiptId = params.id!;

  const { data: receipt, isLoading } = useGetGoodsReceipt(receiptId);

  if (isLoading || !receipt) {
    return <div className="p-8 text-muted-foreground">Загрузка...</div>;
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-3xl mx-auto p-8 print:p-0">
        <div className="flex justify-end mb-4 print:hidden">
          <Button onClick={() => window.print()} data-testid="button-print-receipt-doc">
            <Printer className="h-4 w-4 mr-2" />
            Печать
          </Button>
        </div>

        <h1 className="text-xl font-bold text-center mb-1">Поступление товара</h1>
        <p className="text-center text-sm mb-6">
          №{receipt.docNumber} от {dateFormatter.format(new Date(receipt.createdAt))}
        </p>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div>
            <div className="font-semibold">Тип документа:</div>
            <div>{receipt.docType}</div>
          </div>
          <div>
            <div className="font-semibold">Статус:</div>
            <div>{receipt.isPosted ? "Проведён" : "Черновик"}</div>
          </div>
          {receipt.suppliers.length > 0 && (
            <div>
              <div className="font-semibold">Поставщики:</div>
              <div>{receipt.suppliers.join(", ")}</div>
            </div>
          )}
          {receipt.note && (
            <div>
              <div className="font-semibold">Примечание:</div>
              <div>{receipt.note}</div>
            </div>
          )}
        </div>

        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 text-left">№</th>
              <th className="border border-black px-2 py-1 text-left">Товар</th>
              <th className="border border-black px-2 py-1 text-left">Ед.</th>
              <th className="border border-black px-2 py-1 text-right">Кол-во</th>
              <th className="border border-black px-2 py-1 text-right">Цена</th>
              <th className="border border-black px-2 py-1 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, index) => (
              <tr key={item.id}>
                <td className="border border-black px-2 py-1">{index + 1}</td>
                <td className="border border-black px-2 py-1">{item.productName}</td>
                <td className="border border-black px-2 py-1">{item.productUnit}</td>
                <td className="border border-black px-2 py-1 text-right">{item.quantity}</td>
                <td className="border border-black px-2 py-1 text-right">
                  {currency.format(item.price)}
                </td>
                <td className="border border-black px-2 py-1 text-right">
                  {currency.format(item.quantity * item.price)}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1 text-right font-semibold">
                Итого:
              </td>
              <td className="border border-black px-2 py-1 text-right font-semibold">
                {currency.format(receipt.totalSum)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-8 text-sm mt-12">
          <div>
            <div className="mb-8">Принял: ____________________</div>
            <div>Дата: ____________________</div>
          </div>
          <div>
            <div className="mb-8">Сдал: ____________________</div>
            <div>М.П.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
