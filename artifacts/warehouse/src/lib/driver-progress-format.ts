import * as XLSX from "xlsx";

// Formatting from the supplied workbook; no source names or delivery data embedded.
function stylesXml() {
  const style = (fill: number, percent = false, red = false, wrap = false, left = false) =>
    `<xf numFmtId="${percent ? 165 : 0}" fontId="${red ? 1 : 0}" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="${left ? "left" : "center"}" vertical="center"${wrap ? ' wrapText="1"' : ""}/></xf>`;
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    style(0, false, false, false, true), style(0, false, false, true),
    style(2, false, false, true), style(3, false, false, true),
    style(2), style(2, true), style(3), style(3, true),
    style(0, false, true, false, true), style(2, false, true),
    style(2, true, true), style(3, false, true), style(3, true, true),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="2">${["FF000000", "FFFF0000"].map(color => `<font><sz val="12"/><color rgb="${color}"/><name val="Calibri"/><family val="2"/></font>`).join("")}</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEBF1DE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEEF3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${["left", "right", "top", "bottom"].map(side => `<${side} style="thin"><color indexed="64"/></${side}>`).join("")}<diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

/** SheetJS CE does not write custom cell styles; apply them to the XLSX package. */
export function formatDriverProgressWorkbook(workbook: XLSX.WorkBook): Uint8Array {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const lastRow = XLSX.utils.decode_range(sheet["!ref"]!).e.r + 1;
  const archive = XLSX.CFB.read(new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })), { type: "buffer" });
  const entry = XLSX.CFB.find(archive, "/xl/worksheets/sheet1.xml");
  if (!entry) throw new Error("Не найден лист сводки в Excel");
  let xml = new TextDecoder().decode(entry.content);
  xml = xml.replace(/<c\b([^>]*)>/g, (tag, attributes: string) => {
    const address = /\br="([A-Z]+)(\d+)"/.exec(attributes);
    if (!address) return tag;
    const col = XLSX.utils.decode_col(address[1]);
    const row = Number(address[2]);
    let id = 0;
    if (row === 3 || row === 4) id = col === 0 ? 2 : col <= 6 ? 3 : 4;
    if (row >= 5) {
      const red = row < lastRow && Number(sheet[`B${row}`]?.v) > Number(sheet[`D${row}`]?.v);
      const percent = col > 0 && col % 2 === 0 && sheet[`${address[1]}${row}`]?.t === "n";
      id = col === 0 ? (red ? 9 : 1)
        : col <= 6 ? (red ? (percent ? 11 : 10) : (percent ? 6 : 5))
          : red ? (percent ? 13 : 12) : (percent ? 8 : 7);
    }
    return `<c${attributes.replace(/\s+s="[^"]*"/g, "").replace(/\/$/, "")} s="${id}"${attributes.endsWith("/") ? "/" : ""}>`;
  });
  xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,
    '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="4" topLeftCell="B5" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B5" sqref="B5"/></sheetView></sheetViews>');
  // Exact widths from the reference file, independent of SheetJS font-width conversion.
  xml = xml.replace(/<cols>[\s\S]*?<\/cols>/,
    '<cols><col min="1" max="1" width="34.5" customWidth="1"/><col min="2" max="13" width="12.5" customWidth="1"/></cols>');
  entry.content = new TextEncoder().encode(xml);
  entry.size = entry.content.length;
  const styles = XLSX.CFB.find(archive, "/xl/styles.xml");
  if (!styles) throw new Error("Не найдены стили Excel");
  styles.content = new TextEncoder().encode(stylesXml());
  styles.size = styles.content.length;
  return new Uint8Array(XLSX.CFB.write(archive, { type: "buffer", fileType: "zip", compression: true }));
}