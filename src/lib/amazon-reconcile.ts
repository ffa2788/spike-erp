import { usd } from "./format";
import { htmlToPdf } from "./html-to-pdf";

export type ReconcileOrder = {
  orderId: string;
  sku: string;
  purchaseDate: string;
  shipped: boolean;
  cancelled: boolean;
  netCents: number;
  productId: string | null;
  fulfillment: string;
};

export type ReconcileInvoice = {
  number: string;
  marketplaceOrderId: string;
  totalCents: number;
  balanceCents: number;
  issuedOn: string;
};

export type ReconcileLine = {
  settlementId: string;
  type: string;
  orderId: string;
  sku: string;
  day: string;
  productSalesCents: number;
  sellingFeeCents: number;
  fbaFeeCents: number;
  otherCents: number;
  otherTransactionFeeCents: number;
  totalCents: number;
};

export type ReconcileDifference = {
  kind: "missing order" | "duplicate" | "unmapped SKU" | "fee mismatch" | "payout";
  reference: string;
  detail: string;
};

export type AmazonReconciliation = {
  period: string;
  orders: number;
  invoices: number;
  grossSalesCents: number;
  feesCents: number;
  refundsCents: number;
  refundCount: number;
  reimbursementsCents: number;
  expectedPayoutCents: number;
  depositCents: number;
  differences: ReconcileDifference[];
};

export function reconcileAmazonPeriod(input: {
  period: string;
  orders: ReconcileOrder[];
  invoices: ReconcileInvoice[];
  lines: ReconcileLine[];
}): AmazonReconciliation {
  const period = input.period.trim();
  const byMonth = /^\d{4}-\d{2}$/.test(period);
  const inPeriod = (value: string) => (byMonth ? value.slice(0, 7) === period : value === period);
  const lines = input.lines.filter((line) => (byMonth ? inPeriod(line.day) || inPeriod(line.settlementId) : line.settlementId === period));
  const orderIds = new Set(lines.map((line) => line.orderId).filter(Boolean));
  const orders = input.orders.filter((order) => (byMonth ? inPeriod(order.purchaseDate) : orderIds.has(order.orderId)));
  const invoices = input.invoices.filter((invoice) => (byMonth ? inPeriod(invoice.issuedOn) : orderIds.has(invoice.marketplaceOrderId)));
  const orderRows = lines.filter((line) => line.type.trim().toLowerCase() === "order");
  const refundRows = lines.filter((line) => /refund/i.test(line.type));
  const adjustmentRows = lines.filter((line) => line.type.trim().toLowerCase() === "adjustment");
  const transfers = lines.filter((line) => line.type.trim().toLowerCase() === "transfer");
  const grossSalesCents = orderRows.reduce((sum, line) => sum + line.productSalesCents, 0);
  const feesCents = lines.reduce((sum, line) => sum + Math.abs(Math.min(0, line.sellingFeeCents)) + Math.abs(Math.min(0, line.fbaFeeCents)) + Math.abs(Math.min(0, line.otherTransactionFeeCents)) + (line.type.trim().toLowerCase() === "order" ? 0 : Math.abs(Math.min(0, line.otherCents))), 0);
  const refundsCents = refundRows.reduce((sum, line) => sum + line.totalCents, 0);
  const reimbursementsCents = adjustmentRows.filter((line) => line.totalCents > 0).reduce((sum, line) => sum + line.totalCents, 0);
  const nonTransfer = lines.filter((line) => line.type.trim().toLowerCase() !== "transfer").reduce((sum, line) => sum + line.totalCents, 0);
  const depositCents = transfers.reduce((sum, line) => sum + -line.totalCents, 0);
  const differences: ReconcileDifference[] = [];
  const invoicesByOrder = new Map<string, ReconcileInvoice[]>();
  for (const invoice of invoices) {
    const list = invoicesByOrder.get(invoice.marketplaceOrderId) ?? [];
    list.push(invoice);
    invoicesByOrder.set(invoice.marketplaceOrderId, list);
  }
  const seen = new Set<string>();
  for (const order of orders) {
    if (!order.shipped || order.cancelled) continue;
    if (seen.has(order.orderId)) continue;
    seen.add(order.orderId);
    if (!order.productId) {
      differences.push({ kind: "unmapped SKU", reference: order.orderId, detail: `${order.sku || "blank SKU"} has no SPIKE product, so no A- invoice was posted.` });
      continue;
    }
    const matches = invoicesByOrder.get(order.orderId) ?? [];
    if (matches.length === 0) differences.push({ kind: "missing order", reference: order.orderId, detail: `Shipped ${order.fulfillment || "Amazon"} order has no A- invoice.` });
    if (matches.length > 1) differences.push({ kind: "duplicate", reference: order.orderId, detail: matches.map((invoice) => invoice.number).join(", ") });
    const settlementGross = orderRows.filter((line) => line.orderId === order.orderId).reduce((sum, line) => sum + line.productSalesCents, 0);
    const invoiceGross = matches.reduce((sum, invoice) => sum + invoice.totalCents, 0);
    if (matches.length === 1 && settlementGross > 0 && Math.abs(settlementGross - invoiceGross) > 1) {
      differences.push({ kind: "fee mismatch", reference: order.orderId, detail: `Invoice ${matches[0].number} is ${usd(invoiceGross)}. The settlement product sales are ${usd(settlementGross)}.` });
    }
  }
  if (depositCents !== 0 && Math.abs(depositCents - nonTransfer) > 1) {
    differences.push({ kind: "payout", reference: period, detail: `Expected payout ${usd(nonTransfer)} does not match the bank deposit ${usd(depositCents)}.` });
  }
  return {
    period,
    orders: seen.size,
    invoices: invoices.length,
    grossSalesCents,
    feesCents,
    refundsCents,
    refundCount: refundRows.length,
    reimbursementsCents,
    expectedPayoutCents: nonTransfer,
    depositCents,
    differences,
  };
}

export function reconciliationHtml(report: AmazonReconciliation): string {
  const rows = report.differences.map((row) => `<tr><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.reference)}</td><td>${escapeHtml(row.detail)}</td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Helvetica, Arial, sans-serif; color: #0f2b46; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
  </style></head><body>
    <h1>Amazon reconciliation ${escapeHtml(report.period)}</h1>
    <p>${report.orders} orders, ${report.invoices} invoices. Gross ${usd(report.grossSalesCents)}. Fees ${usd(report.feesCents)}. Refunds ${usd(report.refundsCents)}. Reimbursements ${usd(report.reimbursementsCents)}.</p>
    <p>Expected payout ${usd(report.expectedPayoutCents)}. Bank deposit ${usd(report.depositCents)}.</p>
    <table><thead><tr><th>Difference</th><th>Reference</th><th>Detail</th></tr></thead><tbody>${rows || "<tr><td colspan=\"3\">No differences.</td></tr>"}</tbody></table>
  </body></html>`;
}

export async function reconciliationPdf(report: AmazonReconciliation): Promise<Uint8Array> {
  return htmlToPdf(reconciliationHtml(report));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
