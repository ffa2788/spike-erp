import * as XLSX from "xlsx";

/** First worksheet of a Sage .xlsx export, as CSV text the rest of the importer already understands. */
export function xlsxToCsv(bytes: Uint8Array): string {
  const book = XLSX.read(bytes, { type: "array" });
  const name = book.SheetNames[0];
  if (!name) return "";
  return XLSX.utils.sheet_to_csv(book.Sheets[name]);
}
