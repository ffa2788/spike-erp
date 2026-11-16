"use server";

import { usd } from "@/lib/format";
import { importAllOrdersFile, importFbaFile, saveAmazonSkuMap } from "@/lib/services/amazon-import";
import { importPaymentsFile } from "@/lib/services/amazon-payments-import";
import { requireCan } from "./actor";
import { fail, succeed } from "./http";

async function fileText(formData: FormData) {
  const file = formData.get("file");
  const pasted = String(formData.get("csv") ?? "");
  if (file instanceof File && file.size > 0) return file.text();
  return pasted;
}

export async function importOrdersAction(formData: FormData) {
  const actor = await requireCan("importData");
  const text = await fileText(formData);
  if (!text.trim()) fail("/sales/amazon/import", "Choose the All Orders report.");
  const result = await importAllOrdersFile(actor, text);
  if (!result.ok) fail("/sales/amazon/import", result.error);
  const summary = result.value;
  succeed(
    "/sales/amazon/import",
    `Orders: read ${summary.rowsRead}, new ${summary.created}, updated ${summary.updated}, cancelled skipped ${summary.cancelled}, unmapped ${summary.unmapped.length}. Invoices ${summary.invoices.join(", ") || "none"}.`,
  );
}

export async function importFbaAction(formData: FormData) {
  await requireCan("importData");
  const text = await fileText(formData);
  if (!text.trim()) fail("/sales/amazon/import", "Choose the Manage FBA Inventory report.");
  const result = await importFbaFile(text);
  if (!result.ok) fail("/sales/amazon/import", result.error);
  succeed(
    "/sales/amazon/import",
    `FBA: read ${result.value.rowsRead}, saved ${result.value.saved}, unmapped ${result.value.unmapped.length}.`,
  );
}

export async function importPaymentsAction(formData: FormData) {
  const actor = await requireCan("importData");
  const text = await fileText(formData);
  if (!text.trim()) fail("/sales/amazon/import", "Choose the payments date range report.");
  const result = await importPaymentsFile(actor, text);
  if (!result.ok) fail("/sales/amazon/import", result.error);
  const summary = result.value;
  succeed(
    "/sales/amazon/import",
    `Payments: read ${summary.rowsRead}, new ${summary.created}, duplicates ${summary.duplicates}. Settled ${summary.settled.join(", ") || "no invoices"}. ${summary.unsettledOrders.length ? `No A- invoice for ${summary.unsettledOrders.join(", ")}. ` : ""}Payouts ${summary.transfers} totaling ${usd(summary.transferCents)}.`,
  );
}

export async function mapAmazonSkuAction(formData: FormData) {
  await requireCan("importData");
  const result = await saveAmazonSkuMap(String(formData.get("amazonSku") ?? ""), String(formData.get("productId") ?? ""));
  if (!result.ok) fail("/sales/amazon/import", result.error);
  succeed("/sales/amazon/import", `Mapped ${result.value.sku}. Ship the open Amazon lines again if they still need an invoice.`);
}
