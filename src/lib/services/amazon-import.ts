import { dedupeOrders, invoiceQty, orderImportSummary, parseAllOrders, parseFbaManageInventory, planSkuMaps, suggestAmazonSku } from "../amazon-reports";
import { parseDateInput } from "../dates";
import { prisma } from "../db";
import { err, ok, type Result } from "../result";
import { postAmazonHistoryInvoice } from "./sales";
import { assembleForAmazonOrders, storeAmazonInvoicePdf } from "./amazon-week";
import type { Actor } from "./shared";

export type AmazonImportSummary = {
  rowsRead: number;
  created: number;
  updated: number;
  cancelled: number;
  invoices: string[];
  unmapped: { sku: string; asin: string; suggestion: string }[];
};

export async function importAllOrdersFile(actor: Actor, text: string): Promise<Result<AmazonImportSummary>> {
  const parsed = parseAllOrders(text);
  const kept = dedupeOrders(parsed);
  const [maps, products, amazon, existing] = await Promise.all([
    prisma.amazonSkuMap.findMany(),
    prisma.product.findMany({ where: { active: true } }),
    prisma.party.findFirst({ where: { channel: "AMAZON", isCustomer: true } }),
    prisma.amazonOrderItem.findMany(),
  ]);
  if (!amazon) return err("Add a customer with the Amazon channel before importing orders.");
  const mapBySku = new Map(maps.filter((row) => row.productId).map((row) => [row.amazonSku, { productId: row.productId!, units: row.units > 0 ? row.units : 1 }]));
  const existingByKey = new Map(existing.map((row) => [`${row.amazonOrderId}|${row.orderItemId}`, row]));
  const summary = orderImportSummary({
    rowsRead: parsed.length,
    kept,
    existingKeys: new Set(existingByKey.keys()),
    mapped: new Set([...mapBySku.keys()]),
  });
  const invoices: string[] = [];
  const pending = new Map<string, { date: Date; shipTo: string; fulfillment: "FBA" | "FBM"; lines: { productId: string; description: string; qty: number; netCents: number; itemKey: string }[] }>();
  for (const row of kept) {
    const key = `${row.amazonOrderId}|${row.orderItemId}`;
    const prior = existingByKey.get(key);
    if (prior && prior.lastUpdated > row.lastUpdated) continue;
    const suggestion = suggestAmazonSku({ sku: row.sku, asin: row.asin, products });
    const known = mapBySku.get(row.sku);
    const productId = known?.productId ?? suggestion.productId;
    const units = known?.units ?? 1;
    if (productId && !known) {
      await prisma.amazonSkuMap.upsert({
        where: { amazonSku: row.sku },
        update: { asin: row.asin, productId },
        create: { amazonSku: row.sku, asin: row.asin, productId },
      });
      mapBySku.set(row.sku, { productId, units: 1 });
    }
    const saved = await prisma.amazonOrderItem.upsert({
      where: { amazonOrderId_orderItemId: { amazonOrderId: row.amazonOrderId, orderItemId: row.orderItemId } },
      update: {
        purchaseDate: parseDateInput(row.purchaseDate) ?? new Date(),
        lastUpdated: row.lastUpdated,
        orderStatus: row.orderStatus,
        fulfillment: row.fulfillment,
        sku: row.sku,
        asin: row.asin,
        productName: row.productName,
        qty: row.qty,
        netCents: row.netCents,
        currency: row.currency || "USD",
        shipCity: row.shipCity,
        shipState: row.shipState,
        shipPostalCode: row.shipPostalCode,
        shipCountry: row.shipCountry,
        cancelled: row.cancelled,
        shipped: row.shipped,
        productId,
      },
      create: {
        amazonOrderId: row.amazonOrderId,
        orderItemId: row.orderItemId,
        purchaseDate: parseDateInput(row.purchaseDate) ?? new Date(),
        lastUpdated: row.lastUpdated,
        orderStatus: row.orderStatus,
        fulfillment: row.fulfillment,
        sku: row.sku,
        asin: row.asin,
        productName: row.productName,
        qty: row.qty,
        netCents: row.netCents,
        currency: row.currency || "USD",
        shipCity: row.shipCity,
        shipState: row.shipState,
        shipPostalCode: row.shipPostalCode,
        shipCountry: row.shipCountry,
        cancelled: row.cancelled,
        shipped: row.shipped,
        productId,
        isExample: true,
      },
    });
    if (row.shipped && !row.cancelled && row.netCents > 0 && productId && !saved.invoiceId) {
      const date = parseDateInput(row.purchaseDate) ?? new Date();
      const bucket = pending.get(row.amazonOrderId) ?? { date, shipTo: `${row.shipCity}, ${row.shipState} ${row.shipPostalCode}`.trim(), fulfillment: row.fulfillment === "FBM" ? "FBM" as const : "FBA" as const, lines: [] };
      bucket.lines.push({ productId, description: row.productName || row.sku, qty: invoiceQty(row.qty, units), netCents: row.netCents, itemKey: saved.id });
      pending.set(row.amazonOrderId, bucket);
    }
  }
  for (const [orderId, bucket] of pending) {
    const posted = await postAmazonHistoryInvoice(actor, {
      partyId: amazon.id,
      orderId,
      date: bucket.date,
      shipTo: bucket.shipTo,
      fulfillment: bucket.fulfillment,
      lines: bucket.lines.map(({ itemKey: _item, ...line }) => line),
    });
    if (!posted.ok) return err(posted.error);
    if (posted.value.created) invoices.push(posted.value.number);
    await prisma.amazonOrderItem.updateMany({
      where: { id: { in: bucket.lines.map((line) => line.itemKey) } },
      data: { invoiceId: posted.value.invoiceId },
    });
  }
  const unmapped = summary.unmapped.filter((row) => !mapBySku.has(row.sku));
  for (const number of invoices) {
    const invoice = await prisma.invoice.findUnique({ where: { number } });
    if (invoice) await storeAmazonInvoicePdf(invoice.id).catch(() => undefined);
  }
  await assembleForAmazonOrders(actor);
  return ok({ ...summary, invoices, unmapped });
}

export async function importFbaFile(text: string): Promise<Result<{ rowsRead: number; saved: number; unmapped: { sku: string; asin: string; suggestion: string }[] }>> {
  let rows;
  try {
    rows = parseFbaManageInventory(text);
  } catch (error) {
    return err(error instanceof Error ? error.message : "The FBA file could not be read.");
  }
  const products = await prisma.product.findMany({ where: { active: true } });
  const maps = await prisma.amazonSkuMap.findMany();
  const mapBySku = new Map(maps.filter((row) => row.productId).map((row) => [row.amazonSku, row.productId!]));
  let saved = 0;
  const unmapped: { sku: string; asin: string; suggestion: string }[] = [];
  for (const row of rows) {
    const suggestion = suggestAmazonSku({ sku: row.sku, asin: row.asin, products });
    const productId = mapBySku.get(row.sku) ?? suggestion.productId;
    if (!productId) {
      unmapped.push({ sku: row.sku, asin: row.asin, suggestion: suggestion.label });
      if (!mapBySku.has(row.sku)) {
        await prisma.amazonSkuMap.create({ data: { amazonSku: row.sku, asin: row.asin } }).catch(() => undefined);
      }
      continue;
    }
    if (!mapBySku.has(row.sku)) {
      await prisma.amazonSkuMap.upsert({
        where: { amazonSku: row.sku },
        update: { asin: row.asin, productId },
        create: { amazonSku: row.sku, asin: row.asin, productId },
      });
      mapBySku.set(row.sku, productId);
    }
    await prisma.fbaBalance.upsert({
      where: { productId },
      update: {
        fulfillable: row.fulfillable,
        inbound: row.inbound,
        unfulfillable: row.unfulfillable,
        reserved: row.reserved,
        shipped30: row.shipped30,
        daysOfSupply: row.daysOfSupply,
        source: "AMAZON_FILE",
      },
      create: {
        productId,
        fulfillable: row.fulfillable,
        inbound: row.inbound,
        unfulfillable: row.unfulfillable,
        reserved: row.reserved,
        shipped30: row.shipped30,
        daysOfSupply: row.daysOfSupply,
        source: "AMAZON_FILE",
      },
    });
    saved += 1;
  }
  return ok({ rowsRead: rows.length, saved, unmapped });
}

export async function saveAmazonSkuMaps(input: {
  mappings: { amazonSku: string; productId: string; asin?: string }[];
  dryRun: boolean;
}): Promise<Result<{ dryRun: boolean; changes: { amazonSku: string; productId: string; productSku: string; action: "create" | "update" | "same" }[] }>> {
  const products = await prisma.product.findMany({ select: { id: true, sku: true } });
  const existing = await prisma.amazonSkuMap.findMany();
  const planned = planSkuMaps({ mappings: input.mappings, products, existing });
  if (!planned.ok) return planned;
  const changes = planned.changes;
  if (input.dryRun) return ok({ dryRun: true, changes });
  for (const change of changes) {
    const asin = input.mappings.find((row) => row.amazonSku.trim() === change.amazonSku)?.asin?.trim() ?? "";
    await prisma.amazonSkuMap.upsert({
      where: { amazonSku: change.amazonSku },
      update: { productId: change.productId, ...(asin ? { asin } : {}) },
      create: { amazonSku: change.amazonSku, asin, productId: change.productId },
    });
    await prisma.amazonOrderItem.updateMany({ where: { sku: change.amazonSku, productId: null }, data: { productId: change.productId } });
  }
  return ok({ dryRun: false, changes });
}

export async function saveAmazonSkuMap(amazonSku: string, productId: string) {
  const sku = amazonSku.trim();
  if (!sku || !productId) return err("Choose the Amazon SKU and the SPIKE product.");
  await prisma.amazonSkuMap.upsert({
    where: { amazonSku: sku },
    update: { productId },
    create: { amazonSku: sku, asin: "", productId },
  });
  await prisma.amazonOrderItem.updateMany({ where: { sku, productId: null }, data: { productId } });
  return ok({ sku });
}
