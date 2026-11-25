import { dedupePayments, paymentDay, paymentFingerprint, paymentImportTotals, readAmazonMoneyFile } from "../amazon-payments";
import { orderStockHolds } from "../amazon-stock";
import { dedupeOrders, invoiceQty, parseAllOrders, parseFbaManageInventory, suggestAmazonSku } from "../amazon-reports";
import { prisma } from "../db";
import { toDateInput } from "../dates";
import { usd } from "../format";
import { reconcileAmazonPeriod, type AmazonReconciliation } from "../amazon-reconcile";
import { err, ok, type Result } from "../result";
import { importAllOrdersFile, importFbaFile, type AmazonImportSummary } from "./amazon-import";
import { loadBalances } from "./shared";
import { importPaymentsFile, type PaymentsImportSummary } from "./amazon-payments-import";
import type { Actor } from "./shared";

export type AmazonBundleSummary = {
  sentence: string;
  invoicesCreated: number;
  invoiceNumbers: string[];
  refunds: number;
  feeCents: number;
  depositCents: number;
  unmapped: { sku: string; asin: string; suggestion: string }[];
  orders: AmazonImportSummary | null;
  payments: PaymentsImportSummary | null;
  fbaSaved: number;
};

export function amazonSummarySentence(input: { invoices: number; refunds: number; feeCents: number; depositCents: number; unmapped: number }): string {
  const invoices = `${input.invoices} invoice${input.invoices === 1 ? "" : "s"} created`;
  const refunds = `${input.refunds} refund${input.refunds === 1 ? "" : "s"}`;
  return `${invoices}, ${refunds}, ${usd(input.feeCents)} fees, deposit ${usd(input.depositCents)} matched. ${input.unmapped} unmapped SKU${input.unmapped === 1 ? "" : "s"}.`;
}

export type AmazonPreview = {
  dryRun: true;
  amazonCustomer: { id: string; code: string; name: string } | null;
  blocked: string | null;
  invoices: { orderId: string; fulfillment: string; lines: { sku: string; productId: string; qty: number; netCents: number }[] }[];
  held: { orderId: string; sku: string; product: string; needed: number; available: number; reason: string }[];
  neededMappings: { sku: string; asin: string }[];
  newMappings: { sku: string; productId: string }[];
  fees: { feeCents: number; refunds: number; reimbursements: number; transferCents: number; transfers: number } | null;
  fba: { sku: string; fulfillable: number; inbound: number; reserved: number; unfulfillable: number; total: number; productId: string | null }[] | null;
};

export async function previewAmazonReports(files: { orders?: string; payments?: string; settlement?: string; fba?: string }): Promise<Result<AmazonPreview>> {
  if (!files.orders?.trim() && !files.payments?.trim() && !files.settlement?.trim() && !files.fba?.trim()) {
    return err("Attach an All Orders report, a payments file, a settlement flat file, or an FBA inventory report.");
  }
  const amazon = await prisma.party.findFirst({ where: { channel: "AMAZON", isCustomer: true }, select: { id: true, code: true, name: true } });
  const blocked = files.orders?.trim() && !amazon ? "Add a customer with the Amazon channel before importing orders." : null;
  const [maps, products, items, invoices] = await Promise.all([
    prisma.amazonSkuMap.findMany(),
    prisma.product.findMany({ where: { active: true }, select: { id: true, sku: true, name: true } }),
    prisma.amazonOrderItem.findMany({ select: { amazonOrderId: true, orderItemId: true, lastUpdated: true, invoiceId: true } }),
    prisma.invoice.findMany({ where: { channel: "AMAZON", status: { not: "VOID" } }, select: { marketplaceOrderId: true } }),
  ]);
  const mapBySku = new Map(maps.filter((row) => row.productId).map((row) => [row.amazonSku, { productId: row.productId!, units: row.units > 0 ? row.units : 1 }]));
  const invoiced = new Set(invoices.map((row) => row.marketplaceOrderId).filter(Boolean));
  const existingItems = new Map(items.map((row) => [`${row.amazonOrderId}|${row.orderItemId}`, row]));
  const invoicesOut: AmazonPreview["invoices"] = [];
  const held: AmazonPreview["held"] = [];
  const needed = new Map<string, { sku: string; asin: string }>();
  const freshMaps = new Map<string, string>();
  if (files.orders?.trim()) {
    const pending = new Map<string, { fulfillment: string; date: string; lines: { sku: string; productId: string; productSku: string; qty: number; netCents: number }[] }>();
    for (const row of dedupeOrders(parseAllOrders(files.orders))) {
      if (row.cancelled) continue;
      const prior = existingItems.get(`${row.amazonOrderId}|${row.orderItemId}`);
      if (prior && prior.lastUpdated > row.lastUpdated) continue;
      const exact = suggestAmazonSku({ sku: row.sku, asin: row.asin, products }).productId;
      const known = mapBySku.get(row.sku);
      const productId = known?.productId ?? exact;
      if (exact && !known) freshMaps.set(row.sku, exact);
      if (!productId) {
        if (row.sku) needed.set(row.sku, { sku: row.sku, asin: row.asin });
        continue;
      }
      if (row.shipped && row.netCents > 0 && !prior?.invoiceId && !invoiced.has(row.amazonOrderId)) {
        const bucket = pending.get(row.amazonOrderId) ?? { fulfillment: row.fulfillment, date: row.purchaseDate, lines: [] };
        bucket.lines.push({
          sku: row.sku,
          productId,
          productSku: products.find((product) => product.id === productId)?.sku ?? productId,
          qty: invoiceQty(row.qty, known?.units ?? 1),
          netCents: row.netCents,
        });
        pending.set(row.amazonOrderId, bucket);
      }
    }
    const [stock, locations] = await Promise.all([
      prisma.$transaction((tx) => loadBalances(tx)),
      prisma.location.findMany(),
    ]);
    for (const [orderId, bucket] of pending) {
      const place = locations.find((location) => location.code === (bucket.fulfillment === "FBM" ? "MAIN" : "AMAZON"));
      const short = place ? orderStockHolds(stock, place.id, bucket.date || toDateInput(new Date()), bucket.lines) : [];
      if (!place || short.length) {
        held.push(...(short.length ? short : [{ sku: bucket.lines[0]?.sku ?? "", product: bucket.lines[0]?.productSku ?? "", needed: bucket.lines[0]?.qty ?? 0, available: 0, reason: "The warehouse for this Amazon order is not set up." }]).map((row) => ({ orderId, ...row })));
        continue;
      }
      invoicesOut.push({ orderId, fulfillment: bucket.fulfillment, lines: bucket.lines.map(({ productSku: _productSku, ...line }) => line) });
    }
  }
  let fba: AmazonPreview["fba"] = null;
  if (files.fba?.trim()) {
    let rows;
    try {
      rows = parseFbaManageInventory(files.fba);
    } catch (error) {
      return err(error instanceof Error ? error.message : "The FBA file could not be read.");
    }
    fba = rows.map((row) => {
      const exact = suggestAmazonSku({ sku: row.sku, asin: row.asin, products }).productId;
      const productId = mapBySku.get(row.sku)?.productId ?? exact ?? null;
      if (exact && !mapBySku.has(row.sku)) freshMaps.set(row.sku, exact);
      if (!productId && row.sku) needed.set(row.sku, { sku: row.sku, asin: row.asin });
      return { sku: row.sku, fulfillable: row.fulfillable, inbound: row.inbound, reserved: row.reserved, unfulfillable: row.unfulfillable, total: row.inboundQuantity, productId };
    });
  }
  let fees: AmazonPreview["fees"] = null;
  const money = [files.payments, files.settlement].filter((text): text is string => Boolean(text?.trim()));
  if (money.length) {
    const known = new Set((await prisma.amazonSettlementLine.findMany({ select: { fingerprint: true } })).map((row) => row.fingerprint));
    const fresh = [];
    for (const text of money) {
      const parsed = readAmazonMoneyFile(text);
      if (parsed.error) return err(parsed.error);
      for (const row of dedupePayments(parsed.rows).kept) {
        const fingerprint = paymentFingerprint(row);
        if (known.has(fingerprint)) continue;
        known.add(fingerprint);
        fresh.push(row);
      }
    }
    fees = paymentImportTotals(fresh);
  }
  return ok({
    dryRun: true,
    amazonCustomer: amazon,
    blocked,
    invoices: invoicesOut,
    held,
    neededMappings: [...needed.values()],
    newMappings: [...freshMaps.entries()].map(([sku, productId]) => ({ sku, productId })),
    fees,
    fba,
  });
}

export async function importAmazonReports(
  actor: Actor,
  files: { orders?: string; payments?: string; settlement?: string; fba?: string },
): Promise<Result<AmazonBundleSummary>> {
  if (!files.orders?.trim() && !files.payments?.trim() && !files.settlement?.trim() && !files.fba?.trim()) {
    return err("Attach an All Orders report, a payments file, a settlement flat file, or an FBA inventory report.");
  }
  let orders: AmazonImportSummary | null = null;
  let payments: PaymentsImportSummary | null = null;
  let fbaSaved = 0;
  const unmapped: { sku: string; asin: string; suggestion: string }[] = [];
  if (files.orders?.trim()) {
    const posted = await importAllOrdersFile(actor, files.orders);
    if (!posted.ok) return posted;
    orders = posted.value;
    unmapped.push(...posted.value.unmapped);
  }
  if (files.fba?.trim()) {
    const posted = await importFbaFile(files.fba);
    if (!posted.ok) return posted;
    fbaSaved = posted.value.saved;
    unmapped.push(...posted.value.unmapped);
  }
  if (files.payments?.trim()) {
    const posted = await importPaymentsFile(actor, files.payments);
    if (!posted.ok) return posted;
    payments = posted.value;
  }
  if (files.settlement?.trim()) {
    const posted = await importPaymentsFile(actor, files.settlement);
    if (!posted.ok) return posted;
    payments = payments
      ? {
          ...posted.value,
          rowsRead: payments.rowsRead + posted.value.rowsRead,
          created: payments.created + posted.value.created,
          duplicates: payments.duplicates + posted.value.duplicates,
          settled: [...payments.settled, ...posted.value.settled],
          unsettledOrders: [...payments.unsettledOrders, ...posted.value.unsettledOrders],
          transfers: payments.transfers + posted.value.transfers,
          transferCents: payments.transferCents + posted.value.transferCents,
          refunds: payments.refunds + posted.value.refunds,
          feeCents: payments.feeCents + posted.value.feeCents,
          reimbursements: payments.reimbursements + posted.value.reimbursements,
        }
      : posted.value;
  }
  const summary: AmazonBundleSummary = {
    invoicesCreated: orders?.invoices.length ?? 0,
    invoiceNumbers: orders?.invoices ?? [],
    refunds: payments?.refunds ?? 0,
    feeCents: payments?.feeCents ?? 0,
    depositCents: payments?.transferCents ?? 0,
    unmapped,
    orders,
    payments,
    fbaSaved,
    sentence: "",
  };
  summary.sentence = amazonSummarySentence({
    invoices: summary.invoicesCreated,
    refunds: summary.refunds,
    feeCents: summary.feeCents,
    depositCents: summary.depositCents,
    unmapped: unmapped.length,
  });
  return ok(summary);
}

export async function loadAmazonReconciliation(period: string): Promise<Result<AmazonReconciliation>> {
  if (!period.trim()) return err("Pass period as YYYY-MM or a settlement id.");
  const [orders, invoices, lines] = await Promise.all([
    prisma.amazonOrderItem.findMany(),
    prisma.invoice.findMany({ where: { channel: "AMAZON", status: { not: "VOID" } } }),
    prisma.amazonSettlementLine.findMany(),
  ]);
  return ok(reconcileAmazonPeriod({
    period,
    orders: orders.map((order) => ({
      orderId: order.amazonOrderId,
      sku: order.sku,
      purchaseDate: toDateInput(order.purchaseDate),
      shipped: order.shipped,
      cancelled: order.cancelled,
      netCents: order.netCents,
      productId: order.productId,
      fulfillment: order.fulfillment,
    })),
    invoices: invoices.map((invoice) => ({
      number: invoice.number,
      marketplaceOrderId: invoice.marketplaceOrderId,
      totalCents: invoice.totalCents,
      balanceCents: invoice.balanceCents,
      issuedOn: toDateInput(invoice.issuedOn),
    })),
    lines: lines.map((line) => ({
      settlementId: line.settlementId,
      type: line.type,
      orderId: line.orderId,
      sku: line.sku,
      day: /^\d{4}-\d{2}-\d{2}/.test(line.postedAt) ? line.postedAt.slice(0, 10) : paymentDay(line.postedAt),
      productSalesCents: line.productSalesCents,
      sellingFeeCents: line.sellingFeeCents,
      fbaFeeCents: line.fbaFeeCents,
      otherCents: line.otherCents,
      otherTransactionFeeCents: line.otherTransactionFeeCents,
      totalCents: line.totalCents,
    })),
  }));
}
