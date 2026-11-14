import { parseLooseDate } from "./dates";
import { cleanCode } from "./names";
import { parseMoneyToCents, parseQty } from "./pricing";
import { pick } from "./csv";

export type AmazonOrder = {
  orderId: string;
  date: string;
  sku: string;
  qty: number;
  itemPriceCents: number;
  referralFeeCents: number;
  fbaFeeCents: number;
};

export function validateAmazonOrders(
  rows: Record<string, string>[],
  products: { sku: string; sellable: boolean; priceStatus: string }[],
): { rows: { rowNumber: number; status: "ok" | "error"; messages: string[]; summary: string; data: AmazonOrder | null }[]; ready: AmazonOrder[] } {
  const bySku = new Map(products.map((product) => [product.sku.toUpperCase(), product]));
  const seen = new Set<string>();
  const result = rows.map((row, index) => {
    const messages: string[] = [];
    const orderId = pick(row, "order-id", "order id", "Order ID");
    const date = parseLooseDate(pick(row, "date", "purchase-date"));
    const sku = cleanCode(pick(row, "sku", "item"));
    const qty = parseQty(pick(row, "quantity", "qty"));
    const price = parseMoneyToCents(pick(row, "item-price", "item price", "price"));
    const referral = parseMoneyToCents(pick(row, "referral-fee", "referral fee") || "0");
    const fba = parseMoneyToCents(pick(row, "fba-fee", "fba fee") || "0");
    if (!orderId) messages.push("Each row needs an Amazon order id.");
    else if (seen.has(orderId)) messages.push(`Order ${orderId} is listed twice.`);
    if (!date) messages.push("Date must look like 2026-11-14 or 11/14/2026.");
    if (!sku) messages.push("Each row needs a SKU that matches a SPIKE product.");
    const product = sku ? bySku.get(sku) : undefined;
    if (sku && !product) messages.push(`SKU ${sku} is not on the product list.`);
    else if (product && (!product.sellable || product.priceStatus !== "CONFIRMED")) {
      messages.push(`SKU ${sku} does not have a confirmed selling price, so it cannot be imported.`);
    }
    if (!qty) messages.push("Quantity must be greater than zero.");
    if (price == null || price <= 0) messages.push("Item price must be greater than zero.");
    if (qty && price === qty * 100) {
      messages.push("The unit price is $1.00. SPIKE blocks that as a placeholder.");
    }
    if (referral == null || referral < 0 || fba == null || fba < 0) messages.push("Fees cannot be negative.");
    if (price != null && referral != null && fba != null && referral + fba > price) {
      messages.push("Fees are larger than the item price.");
    }
    const data: AmazonOrder | null =
      messages.length || !date || !qty || price == null || referral == null || fba == null
        ? null
        : { orderId, date, sku, qty, itemPriceCents: price, referralFeeCents: referral, fbaFeeCents: fba };
    if (data) seen.add(orderId);
    return {
      rowNumber: index + 2,
      status: messages.length ? ("error" as const) : ("ok" as const),
      messages,
      summary: orderId || sku || "(blank row)",
      data,
    };
  });
  return { rows: result, ready: result.flatMap((row) => (row.data ? [row.data] : [])) };
}
