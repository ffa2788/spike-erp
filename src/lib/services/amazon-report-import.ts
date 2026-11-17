import { paymentDay } from "../amazon-payments";
import { prisma } from "../db";
import { toDateInput } from "../dates";
import { usd } from "../format";
import { reconcileAmazonPeriod, type AmazonReconciliation } from "../amazon-reconcile";
import { err, ok, type Result } from "../result";
import { importAllOrdersFile, importFbaFile, type AmazonImportSummary } from "./amazon-import";
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
