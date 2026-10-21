import * as XLSX from "xlsx";

type PriceListProduct = { name: string; unit: string; price: number };

export function buildProductPriceList(
  products: readonly PriceListProduct[],
  generatedAt = new Date(),
) {
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(generatedAt);
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const sheet = XLSX.utils.aoa_to_sheet([
    ["ПРАЙС"],
    ["ООО ТД Альянс"],
    [`Дата формирования прайса: ${date}`],
    [],
    ["Наименование товара", "Единица измерения", "Цена продажная"],
    ...sorted.map((product) => [product.name, product.unit, product.price]),
  ]);
  sheet["!merges"] = [0, 1, 2].map((row) => ({
    s: { r: row, c: 0 }, e: { r: row, c: 2 },
  }));
  sheet["!cols"] = [{ wch: 65 }, { wch: 22 }, { wch: 22 }];
  for (let row = 6; row < sorted.length + 6; row++) {
    sheet[`C${row}`].z = '#,##0.00';
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "ПРАЙС");
  return { workbook, filename: `ПРАЙС_${date}.xlsx` };
}

export function downloadProductPriceList(products: readonly PriceListProduct[]) {
  const { workbook, filename } = buildProductPriceList(products);
  XLSX.writeFile(workbook, filename);
}