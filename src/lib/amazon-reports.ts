import { parseCsv } from "./csv";

/** Seller Central files. Only the fields SPIKE keeps are returned. Buyer identifiers are never copied out. */

export const ALL_ORDERS_HEADERS = [
  "amazon-order-id",
  "merchant-order-id",
  "purchase-date",
  "last-updated-date",
  "order-status",
  "fulfillment-channel",
  "sales-channel",
  "order-channel",
  "url",
  "ship-service-level",
  "product-name",
  "sku",
  "asin",
  "item-status",
  "quantity",
  "currency",
  "item-price",
  "item-tax",
  "shipping-price",
  "shipping-tax",
  "gift-wrap-price",
  "gift-wrap-tax",
  "item-promotion-discount",
  "ship-promotion-discount",
  "ship-city",
  "ship-state",
  "ship-postal-code",
  "ship-country",
  "promotion-ids",
  "cpf",
  "is-business-order",
  "purchase-order-number",
  "price-designation",
  "signature-confirmation-recommended",
  "buyer-identification-number",
  "buyer-identification-type",
  "order-item-id",
  "is-prime",
] as const;

export const FBA_HEADERS_USED = [
  "snapshot-date",
  "sku",
  "fnsku",
  "asin",
  "product-name",
  "available",
  "inbound-working",
  "inbound-shipped",
  "inbound-received",
  "inbound-quantity",
  "Total Reserved Quantity",
  "unfulfillable-quantity",
  "units-shipped-t30",
  "days-of-supply",
] as const;

export type AmazonOrderRow = {
  amazonOrderId: string;
  orderItemId: string;
  purchaseDate: string;
  lastUpdated: string;
  orderStatus: string;
  itemStatus: string;
  fulfillment: "FBA" | "FBM" | "";
  sku: string;
  asin: string;
  productName: string;
  qty: number;
  currency: string;
  itemPriceCents: number;
  promotionCents: number;
  netCents: number;
  shipCity: string;
  shipState: string;
  shipPostalCode: string;
  shipCountry: string;
  cancelled: boolean;
  shipped: boolean;
};

export type FbaSnapshotRow = {
  snapshotDate: string;
  sku: string;
  fnsku: string;
  asin: string;
  productName: string;
  fulfillable: number;
  inbound: number;
  inboundQuantity: number;
  reserved: number;
  unfulfillable: number;
  shipped30: number;
  daysOfSupply: number | null;
};

export type SkuSuggestion = { label: string; productId: string | null };

export function parseReportTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitReportLine(lines[0]).map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitReportLine(line);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
  return { headers, rows };
}

function splitReportLine(line: string): string[] {
  const parts = line.split("\t");
  if (parts.length > 1) return parts;
  return line.split(",");
}

function moneyCents(value: string | undefined): number {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

function num(value: string | undefined): number {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Amazon quantity times how many of the product are in one Amazon unit. */
export function invoiceQty(amazonQty: number, units: number): number {
  const each = units > 0 ? units : 1;
  return amazonQty * each;
}

export function isShippedStatus(value: string): boolean {
  return /^shipped\b/i.test(value.trim());
}

function fulfillmentOf(value: string): "FBA" | "FBM" | "" {
  const text = value.trim().toLowerCase();
  if (text === "amazon" || text === "afn") return "FBA";
  if (text === "merchant" || text === "mfn") return "FBM";
  return "";
}

export function parseAllOrders(text: string): AmazonOrderRow[] {
  const table = parseReportTable(text);
  return table.rows.flatMap((row) => {
    const amazonOrderId = row["amazon-order-id"] ?? "";
    const orderItemId = row["order-item-id"] ?? "";
    if (!amazonOrderId || !orderItemId) return [];
    const orderStatus = row["order-status"] ?? "";
    const itemStatus = row["item-status"] ?? "";
    const cancelled = /cancel/i.test(orderStatus) || /cancel/i.test(itemStatus);
    const itemPriceCents = moneyCents(row["item-price"]);
    const promotionCents = moneyCents(row["item-promotion-discount"]);
    const kept: AmazonOrderRow = {
      amazonOrderId,
      orderItemId,
      purchaseDate: (row["purchase-date"] ?? "").slice(0, 10),
      lastUpdated: row["last-updated-date"] ?? "",
      orderStatus,
      itemStatus,
      fulfillment: fulfillmentOf(row["fulfillment-channel"] ?? ""),
      sku: (row.sku ?? "").trim(),
      asin: (row.asin ?? "").trim(),
      productName: row["product-name"] ?? "",
      qty: num(row.quantity),
      currency: row.currency ?? "",
      itemPriceCents,
      promotionCents,
      netCents: Math.max(0, itemPriceCents - promotionCents),
      shipCity: row["ship-city"] ?? "",
      shipState: row["ship-state"] ?? "",
      shipPostalCode: row["ship-postal-code"] ?? "",
      shipCountry: row["ship-country"] ?? "",
      cancelled,
      shipped: !cancelled && (isShippedStatus(orderStatus) || isShippedStatus(itemStatus)),
    };
    return [kept];
  });
}

/** Same amazon-order-id + order-item-id: the newer last-updated-date wins. A tie keeps the later row. */
export function dedupeOrders(rows: AmazonOrderRow[]): AmazonOrderRow[] {
  const byKey = new Map<string, AmazonOrderRow>();
  for (const row of rows) {
    const key = `${row.amazonOrderId}|${row.orderItemId}`;
    const current = byKey.get(key);
    if (!current || row.lastUpdated >= current.lastUpdated) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function cleanReportText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\uFFFD/g, "");
}

function fbaTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = cleanReportText(text);
  const first = clean.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const tabs = (first.match(/\t/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  if (commas > tabs) return parseCsv(clean);
  return parseReportTable(clean);
}

function headerName(headers: string[], name: string): string | undefined {
  return headers.find((header) => header.trim().toLowerCase() === name.toLowerCase());
}

function cell(row: Record<string, string>, headers: string[], name: string): string {
  const key = headerName(headers, name);
  return key ? (row[key] ?? "") : "";
}

/** A recognized FBA file must not come back as all zeros when the quantity columns have numbers. */
export function fbaZeroProblem(rawQuantity: number, parsedQuantity: number): string | null {
  if (rawQuantity > 0 && parsedQuantity === 0) {
    return "The FBA file has quantities, but SPIKE read zero on every row. Nothing was saved.";
  }
  return null;
}

export function parseFbaManageInventory(text: string): FbaSnapshotRow[] {
  const table = fbaTable(text);
  const modern = Boolean(headerName(table.headers, "afn-fulfillable-quantity"));
  const rows = table.rows.flatMap((row) => {
    const sku = cell(row, table.headers, "sku").trim();
    if (!sku) return [];
    if (modern) {
      const working = num(cell(row, table.headers, "afn-inbound-working-quantity"));
      const shipped = num(cell(row, table.headers, "afn-inbound-shipped-quantity"));
      const receiving = num(cell(row, table.headers, "afn-inbound-receiving-quantity"));
      return [{
        snapshotDate: "",
        sku,
        fnsku: cell(row, table.headers, "fnsku"),
        asin: cell(row, table.headers, "asin").trim(),
        productName: cell(row, table.headers, "product-name").replace(/\uFFFD/g, ""),
        fulfillable: num(cell(row, table.headers, "afn-fulfillable-quantity")),
        inbound: working + shipped + receiving,
        inboundQuantity: num(cell(row, table.headers, "afn-total-quantity")),
        reserved: num(cell(row, table.headers, "afn-reserved-quantity")),
        unfulfillable: num(cell(row, table.headers, "afn-unsellable-quantity")),
        shipped30: 0,
        daysOfSupply: null,
      }];
    }
    const working = num(cell(row, table.headers, "inbound-working"));
    const shipped = num(cell(row, table.headers, "inbound-shipped"));
    const received = num(cell(row, table.headers, "inbound-received"));
    const days = cell(row, table.headers, "days-of-supply");
    return [{
      snapshotDate: cell(row, table.headers, "snapshot-date").slice(0, 10),
      sku,
      fnsku: cell(row, table.headers, "fnsku"),
      asin: cell(row, table.headers, "asin").trim(),
      productName: cell(row, table.headers, "product-name"),
      fulfillable: num(cell(row, table.headers, "available")),
      inbound: working + shipped + received,
      inboundQuantity: num(cell(row, table.headers, "inbound-quantity")),
      reserved: num(cell(row, table.headers, "Total Reserved Quantity")),
      unfulfillable: num(cell(row, table.headers, "unfulfillable-quantity")),
      shipped30: num(cell(row, table.headers, "units-shipped-t30")),
      daysOfSupply: days === "" ? null : num(days),
    }];
  });
  if (modern) {
    const names = ["afn-fulfillable-quantity", "afn-unsellable-quantity", "afn-reserved-quantity", "afn-inbound-working-quantity", "afn-inbound-shipped-quantity", "afn-inbound-receiving-quantity"];
    const raw = table.rows.reduce((sum, row) => sum + names.reduce((inner, name) => inner + num(cell(row, table.headers, name)), 0), 0);
    const parsed = rows.reduce((sum, row) => sum + row.fulfillable + row.unfulfillable + row.reserved + row.inbound, 0);
    const problem = fbaZeroProblem(raw, parsed);
    if (problem) throw new Error(problem);
  }
  return rows;
}

export function planSkuMaps(input: {
  mappings: { amazonSku: string; productId: string; units?: number | null }[];
  products: { id: string; sku: string }[];
  existing: { amazonSku: string; productId: string | null; units?: number }[];
}): { ok: true; changes: { amazonSku: string; productId: string; productSku: string; units: number; action: "create" | "update" | "same" }[] } | { ok: false; error: string } {
  const rows = input.mappings
    .map((row) => ({ amazonSku: row.amazonSku.trim(), productId: row.productId.trim(), units: row.units }))
    .filter((row) => row.amazonSku || row.productId);
  if (rows.length === 0) return { ok: false, error: "Send at least one Amazon SKU and a product ID." };
  if (rows.some((row) => !row.amazonSku || !row.productId)) return { ok: false, error: "Each mapping needs an Amazon SKU and a product ID." };
  for (const row of rows) {
    if (row.units == null) continue;
    if (!Number.isInteger(row.units) || row.units < 1) return { ok: false, error: `Units for ${row.amazonSku} must be a positive whole number.` };
  }
  const known = new Map(input.products.map((product) => [product.id, product.sku]));
  const unknown = rows.find((row) => !known.has(row.productId));
  if (unknown) return { ok: false, error: `Unknown product ID ${unknown.productId}. Nothing was saved.` };
  const bySku = new Map(input.existing.map((row) => [row.amazonSku, row]));
  return {
    ok: true,
    changes: rows.map((row) => {
      const units = row.units ?? 1;
      const prior = bySku.get(row.amazonSku);
      const priorUnits = prior?.units && prior.units > 0 ? prior.units : 1;
      const action = !prior?.productId ? "create" as const : prior.productId === row.productId && priorUnits === units ? "same" as const : "update" as const;
      return { amazonSku: row.amazonSku, productId: row.productId, productSku: known.get(row.productId) ?? "", units, action };
    }),
  };
}

/** Auto-map only when the Amazon seller SKU is the same as a product SKU. Names are not used. */
export function suggestAmazonSku(input: { sku: string; asin: string; products: { id: string; sku: string; name: string }[] }): SkuSuggestion {
  const sku = input.sku.trim().toLowerCase();
  if (!sku) return { label: "", productId: null };
  const match = input.products.find((product) => product.sku.trim().toLowerCase() === sku);
  return { label: match?.sku ?? "", productId: match?.id ?? null };
}

export function orderImportSummary(input: { rowsRead: number; kept: AmazonOrderRow[]; existingKeys: Set<string>; mapped: Set<string> }) {
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  const unmapped: { sku: string; asin: string; suggestion: string }[] = [];
  const seen = new Set<string>();
  for (const row of input.kept) {
    if (row.cancelled) {
      cancelled += 1;
      continue;
    }
    const key = `${row.amazonOrderId}|${row.orderItemId}`;
    if (input.existingKeys.has(key)) updated += 1;
    else created += 1;
    if (!input.mapped.has(row.sku) && !seen.has(row.sku)) {
      seen.add(row.sku);
      unmapped.push({ sku: row.sku, asin: row.asin, suggestion: "" });
    }
  }
  return { rowsRead: input.rowsRead, created, updated, cancelled, unmapped };
}
