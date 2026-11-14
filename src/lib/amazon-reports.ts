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

export const ASIN_SUGGESTIONS: Record<string, string> = {
  B0BZLYZQ2P: "Rust Preventer 1 gal",
  B0CTQ1TFCT: "Rust Preventer 2.5 gal",
  B0CTQ5MFNQ: "Rust Remover",
};

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
      shipped: /^shipped$/i.test(orderStatus) && !cancelled,
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

export function parseFbaManageInventory(text: string): FbaSnapshotRow[] {
  const table = parseReportTable(text);
  const headerOf = (name: string) => table.headers.find((header) => header.toLowerCase() === name.toLowerCase()) ?? name;
  return table.rows.flatMap((row) => {
    const sku = (row[headerOf("sku")] ?? "").trim();
    if (!sku) return [];
    const working = num(row[headerOf("inbound-working")]);
    const shipped = num(row[headerOf("inbound-shipped")]);
    const received = num(row[headerOf("inbound-received")]);
    const days = row[headerOf("days-of-supply")];
    return [{
      snapshotDate: (row[headerOf("snapshot-date")] ?? "").slice(0, 10),
      sku,
      fnsku: row[headerOf("fnsku")] ?? "",
      asin: (row[headerOf("asin")] ?? "").trim(),
      productName: row[headerOf("product-name")] ?? "",
      fulfillable: num(row[headerOf("available")]),
      inbound: working + shipped + received,
      inboundQuantity: num(row[headerOf("inbound-quantity")]),
      reserved: num(row[headerOf("Total Reserved Quantity")]),
      unfulfillable: num(row[headerOf("unfulfillable-quantity")]),
      shipped30: num(row[headerOf("units-shipped-t30")]),
      daysOfSupply: days === undefined || days === "" ? null : num(days),
    }];
  });
}

export function suggestAmazonSku(input: { sku: string; asin: string; products: { id: string; sku: string; name: string }[] }): SkuSuggestion {
  const asin = input.asin.trim().toUpperCase();
  const sku = input.sku.trim();
  const fromAsin = ASIN_SUGGESTIONS[asin] ?? Object.entries(ASIN_SUGGESTIONS).find(([code]) => sku.toUpperCase().startsWith(code))?.[1] ?? "";
  if (!fromAsin) return { label: "", productId: null };
  const wanted = fromAsin.toLowerCase();
  const match = input.products.find((product) => {
    const name = product.name.toLowerCase();
    if (wanted.includes("2.5")) return name.includes("preventer") && name.includes("2.5");
    if (wanted.includes("1 gal")) return name.includes("preventer") && (name.includes("1 gal") || product.sku.toUpperCase() === "RUST-1G");
    if (wanted.includes("remover")) return name.includes("remover");
    return false;
  });
  return { label: fromAsin, productId: match?.id ?? null };
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
      unmapped.push({ sku: row.sku, asin: row.asin, suggestion: ASIN_SUGGESTIONS[row.asin] ?? suggestAmazonSku({ sku: row.sku, asin: row.asin, products: [] }).label });
    }
  }
  return { rowsRead: input.rowsRead, created, updated, cancelled, unmapped };
}
