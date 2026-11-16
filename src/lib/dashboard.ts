import { summarizeAging } from "./aging";
import { channelOf, type ChannelCode } from "./mrp";

export type DashInvoice = {
  issuedOn: string;
  channel: string;
  partyName: string;
  subtotalCents: number;
  lines: { productId: string; productName: string; amountCents: number; cogsCents: number }[];
};

export type Ranked = { name: string; salesCents: number; marginCents: number; marginPercent: number | null };

export type TaxDeadline = { name: string; date: string; days: number };

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function comparePeriods(current: number, prior: number): { deltaCents: number; percent: number | null; words: string } {
  const deltaCents = current - prior;
  if (prior === 0 && current === 0) return { deltaCents: 0, percent: null, words: "No sales in either period." };
  if (prior === 0) return { deltaCents, percent: null, words: "No sales in the prior period." };
  const percent = Math.round((deltaCents / prior) * 1000) / 10;
  const direction = percent > 0 ? "Up" : percent < 0 ? "Down" : "Flat";
  return { deltaCents, percent, words: `${direction} ${Math.abs(percent)}% versus the prior period.` };
}

export function marginPercent(salesCents: number, cogsCents: number): number | null {
  if (salesCents <= 0) return null;
  return Math.round(((salesCents - cogsCents) / salesCents) * 1000) / 10;
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function summarize(invoices: DashInvoice[]) {
  let salesCents = 0;
  let cogsCents = 0;
  const channels: Record<ChannelCode, { salesCents: number; cogsCents: number }> = {
    S: { salesCents: 0, cogsCents: 0 },
    A: { salesCents: 0, cogsCents: 0 },
    W: { salesCents: 0, cogsCents: 0 },
    E: { salesCents: 0, cogsCents: 0 },
  };
  const products = new Map<string, { name: string; salesCents: number; cogsCents: number }>();
  const customers = new Map<string, { salesCents: number; cogsCents: number }>();
  for (const invoice of invoices) {
    const cogs = invoice.lines.reduce((sum, line) => sum + line.cogsCents, 0);
    salesCents += invoice.subtotalCents;
    cogsCents += cogs;
    const channel = channelOf(invoice.channel);
    channels[channel].salesCents += invoice.subtotalCents;
    channels[channel].cogsCents += cogs;
    const customer = customers.get(invoice.partyName) ?? { salesCents: 0, cogsCents: 0 };
    customer.salesCents += invoice.subtotalCents;
    customer.cogsCents += cogs;
    customers.set(invoice.partyName, customer);
    for (const line of invoice.lines) {
      const row = products.get(line.productId) ?? { name: line.productName, salesCents: 0, cogsCents: 0 };
      row.salesCents += line.amountCents;
      row.cogsCents += line.cogsCents;
      products.set(line.productId, row);
    }
  }
  const rank = (map: Map<string, { name?: string; salesCents: number; cogsCents: number }>, withName: boolean): Ranked[] =>
    [...map.entries()]
      .map(([key, row]) => ({
        name: withName ? row.name ?? key : key,
        salesCents: row.salesCents,
        marginCents: row.salesCents - row.cogsCents,
        marginPercent: marginPercent(row.salesCents, row.cogsCents),
      }))
      .sort((a, b) => b.salesCents - a.salesCents || a.name.localeCompare(b.name));
  return { salesCents, cogsCents, marginCents: salesCents - cogsCents, channels, products: rank(products, true), customers: rank(customers, false) };
}

export function upcomingTaxDeadlines(asOf: string, entity: "C_CORP" | "S_CORP"): TaxDeadline[] {
  const [year, month, day] = asOf.split("-").map(Number);
  const salesTax = day <= 20
    ? `${year}-${String(month).padStart(2, "0")}-20`
    : `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-20`;
  const infoYear = month === 1 && day <= 31 ? year : year + 1;
  const returnYear = asOf < `${year}-04-16` && month < 4 ? year : year + 1;
  const corporate = entity === "S_CORP" ? `${returnYear}-03-15` : `${returnYear}-04-15`;
  if (entity === "S_CORP" && asOf > `${year}-03-15` && month < 4) {
    // already past this year's S-corp date; the next one is next year, handled by returnYear when month >= 4
  }
  const rows = [
    { name: "Florida sales tax (DR-15)", date: salesTax },
    { name: "1099 forms due to the IRS", date: `${infoYear}-01-31` },
    { name: entity === "S_CORP" ? "Form 1120-S" : "Form 1120", date: corporate },
  ];
  if (entity === "S_CORP" && asOf > `${year}-03-15`) {
    rows[2] = { name: "Form 1120-S", date: `${year + 1}-03-15` };
  }
  return rows
    .map((row) => ({ ...row, days: daysBetween(asOf, row.date) }))
    .filter((row) => row.days >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function executiveDashboard(input: {
  asOf: string;
  entity: "C_CORP" | "S_CORP";
  invoices: DashInvoice[];
  quotes: { status: string; totalCents: number }[];
  receivables: { balanceCents: number; due: string }[];
  payables: { balanceCents: number; due: string }[];
  cashCents: number;
  unreconciled: number;
  inventoryCents: number;
  belowReorder: number;
  criticalCoverage: number;
  lowCoverage: number;
  ordersToShip: number;
  uninvoicedDeliveries: number;
}) {
  const [year, month, day] = input.asOf.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const priorMonthEnd = addDaysIso(monthStart, -1);
  const priorMonthStart = `${priorMonthEnd.slice(0, 8)}01`;
  const priorMonthSame = `${priorMonthEnd.slice(0, 8)}${String(Math.min(day, Number(priorMonthEnd.slice(8)))).padStart(2, "0")}`;
  const yearStart = `${year}-01-01`;
  const priorYearStart = `${year - 1}-01-01`;
  const priorYearSame = `${year - 1}-${input.asOf.slice(5)}`;
  const pick = (from: string, to: string) => input.invoices.filter((invoice) => inRange(invoice.issuedOn, from, to));
  const mtd = summarize(pick(monthStart, input.asOf));
  const priorMtd = summarize(pick(priorMonthStart, priorMonthSame));
  const ytd = summarize(pick(yearStart, input.asOf));
  const priorYtd = summarize(pick(priorYearStart, priorYearSame));
  const openQuotes = input.quotes.filter((quote) => quote.status === "DRAFT" || quote.status === "SENT");
  const aging = summarizeAging(
    input.receivables.map((row, index) => ({ id: String(index), number: "", name: "", balanceCents: row.balanceCents, due: row.due })),
    input.asOf,
  );
  const soonEnd = addDaysIso(input.asOf, 14);
  const payablesSoon = input.payables.filter((bill) => bill.balanceCents > 0 && bill.due <= soonEnd);
  const payablesSoonCents = payablesSoon.reduce((sum, bill) => sum + bill.balanceCents, 0);
  return {
    mtd: { ...mtd, versus: comparePeriods(mtd.salesCents, priorMtd.salesCents) },
    ytd: { ...ytd, versus: comparePeriods(ytd.salesCents, priorYtd.salesCents) },
    marginPercent: marginPercent(ytd.salesCents, ytd.cogsCents),
    channels: (["S", "A", "W", "E"] as const).map((code) => ({
      code,
      label: code === "S" ? "Direct" : code === "A" ? "Amazon" : code === "W" ? "Walmart" : "Export",
      salesCents: ytd.channels[code].salesCents,
      marginPercent: marginPercent(ytd.channels[code].salesCents, ytd.channels[code].cogsCents),
    })),
    quoteCount: openQuotes.length,
    pipelineCents: openQuotes.reduce((sum, quote) => sum + quote.totalCents, 0),
    receivableCents: aging.totalCents,
    overdueCents: aging.totalCents - aging.buckets.current,
    aging: aging.buckets,
    payablesSoonCents,
    payablesSoonCount: payablesSoon.length,
    cashCents: input.cashCents,
    unreconciled: input.unreconciled,
    inventoryCents: input.inventoryCents,
    belowReorder: input.belowReorder,
    criticalCoverage: input.criticalCoverage,
    lowCoverage: input.lowCoverage,
    topProducts: ytd.products.slice(0, 3),
    topCustomers: ytd.customers.slice(0, 3),
    ordersToShip: input.ordersToShip,
    uninvoicedDeliveries: input.uninvoicedDeliveries,
    taxDeadlines: upcomingTaxDeadlines(input.asOf, input.entity),
  };
}
