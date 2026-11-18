import { summarizeAging } from "../aging";
import { channelName, channelSales, customerSales, periodWindow, productSales, profitStatement, ytdWindow, type PnlLine } from "../owner-reports";
import { toDateInput } from "../dates";
import { prisma } from "../db";
import { balanceSheet, type PostedLine } from "../journals";
import { postedLines } from "../read-models";
import { loadBuySoon } from "./buy-soon";

export type ReportQuery = { period?: string; anchor?: string; from?: string; to?: string; sort?: string };

export function windowFrom(query: ReportQuery, fallback = "2026-10-15") {
  const kind = query.period === "week" || query.period === "custom" ? query.period : "month";
  return { kind, ...periodWindow({ kind, anchor: query.anchor || fallback, from: query.from, to: query.to }) };
}

export async function salesReport(query: ReportQuery) {
  const window = windowFrom(query);
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "VOID" }, issuedOn: { gte: new Date(`${window.priorFrom}T00:00:00Z`), lte: new Date(`${window.to}T23:59:59Z`) } },
    include: { lines: true },
  });
  const row = (invoice: (typeof invoices)[number]) => ({
    channel: invoice.channel,
    fulfillment: invoice.fulfillment,
    cents: invoice.subtotalCents,
    day: toDateInput(invoice.issuedOn),
  });
  const current = invoices.filter((invoice) => inRange(toDateInput(invoice.issuedOn), window.from, window.to)).map(row);
  const prior = invoices.filter((invoice) => inRange(toDateInput(invoice.issuedOn), window.priorFrom, window.priorTo)).map(row);
  return { window, rows: channelSales(current, prior), invoiceCount: current.length };
}

export async function productReport(query: ReportQuery) {
  const window = windowFrom(query);
  const lines = await prisma.invoiceLine.findMany({
    where: { invoice: { status: { not: "VOID" }, issuedOn: { gte: new Date(`${window.from}T00:00:00Z`), lte: new Date(`${window.to}T23:59:59Z`) } } },
  });
  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(lines.map((line) => line.productId))] } } });
  const names = new Map(products.map((product) => [product.id, product.sku + " " + product.name]));
  const sort = query.sort === "qty" || query.sort === "margin" || query.sort === "name" ? query.sort : "revenue";
  return {
    window,
    rows: productSales(lines.map((line) => ({
      id: line.productId,
      name: names.get(line.productId) ?? line.description,
      qty: Number(line.qty),
      revenueCents: Math.round(Number(line.qty) * line.unitPriceCents) - line.discountCents,
      cogsCents: line.cogsCents,
    })), sort),
  };
}

export async function customerReport(query: ReportQuery) {
  const window = windowFrom(query);
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "VOID" }, issuedOn: { gte: new Date(`${window.from}T00:00:00Z`), lte: new Date(`${window.to}T23:59:59Z`) } },
    include: { party: true, lines: true },
  });
  return {
    window,
    rows: customerSales(invoices.map((invoice) => ({
      name: invoice.party.name,
      revenueCents: invoice.subtotalCents,
      cogsCents: invoice.lines.reduce((sum, line) => sum + line.cogsCents, 0),
      balanceCents: invoice.balanceCents,
    }))),
  };
}

export async function profitReport(query: ReportQuery) {
  const window = windowFrom(query);
  const ytd = ytdWindow(window.to);
  const lines = await postedLines();
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "VOID" }, issuedOn: { gte: new Date(`${ytd.from}T00:00:00Z`), lte: new Date(`${window.to}T23:59:59Z`) } },
  });
  const bucket = (from: string, to: string) => invoices.filter((invoice) => inRange(toDateInput(invoice.issuedOn), from, to));
  const byChannel = (list: typeof invoices) => channelSales(list.map((invoice) => ({ channel: invoice.channel, fulfillment: invoice.fulfillment, cents: invoice.subtotalCents })), []).map((row) => row.currentCents);
  const names = ["Direct", "Amazon FBA", "Amazon FBM", "Walmart", "Export"];
  const monthList = bucket(window.from, window.to);
  const priorList = bucket(window.priorFrom, window.priorTo);
  const ytdList = bucket(ytd.from, window.to);
  const monthCh = byChannel(monthList);
  const priorCh = byChannel(priorList);
  const ytdCh = byChannel(ytdList);
  const account = (code: string, from: string, to: string) => movement(lines, code, from, to);
  const expenseNames = lines.filter((line) => line.accountType === "EXPENSE").reduce((map, line) => map.set(line.accountCode, line.accountName), new Map<string, string>());
  const expenses = [...expenseNames.entries()].map(([code, name]) => ({
    name: `${code} ${name}`,
    month: account(code, window.from, window.to),
    prior: account(code, window.priorFrom, window.priorTo),
    ytd: account(code, ytd.from, window.to),
  })).filter((row) => row.month || row.prior || row.ytd);
  const rows = profitStatement({
    revenue: names.map((name, index) => ({ name, month: monthCh[index] ?? 0, prior: priorCh[index] ?? 0, ytd: ytdCh[index] ?? 0 })),
    returns: { month: account("4050", window.from, window.to), prior: account("4050", window.priorFrom, window.priorTo), ytd: account("4050", ytd.from, window.to) },
    discounts: { month: account("4100", window.from, window.to), prior: account("4100", window.priorFrom, window.priorTo), ytd: account("4100", ytd.from, window.to) },
    cogs: { month: typeTotal(lines, "COGS", window.from, window.to), prior: typeTotal(lines, "COGS", window.priorFrom, window.priorTo), ytd: typeTotal(lines, "COGS", ytd.from, window.to) },
    expenses,
    otherIncome: { month: creditMinusDebit(lines, "4200", window.from, window.to), prior: creditMinusDebit(lines, "4200", window.priorFrom, window.priorTo), ytd: creditMinusDebit(lines, "4200", ytd.from, window.to) },
  });
  return { window, rows };
}

export async function balanceReport(asOf = "2026-10-31") {
  const lines = await postedLines();
  return { asOf, sheet: balanceSheet(lines, asOf) };
}

export async function agingReport(asOf = "2026-11-18") {
  const invoices = await prisma.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { party: true } });
  const summary = summarizeAging(invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    name: invoice.party.name,
    balanceCents: invoice.balanceCents,
    due: toDateInput(invoice.dueOn),
  })), asOf);
  return { asOf, summary, invoices: invoices.map((invoice) => ({ number: invoice.number, name: invoice.party.name, due: toDateInput(invoice.dueOn), balanceCents: invoice.balanceCents })) };
}

export async function mrpReport() {
  return loadBuySoon("2026-11-18");
}

function inRange(day: string, from: string, to: string) {
  return day >= from && day <= to;
}

function movement(lines: PostedLine[], code: string, from: string, to: string) {
  return lines.filter((line) => line.accountCode === code && inRange(line.date, from, to)).reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
}

function creditMinusDebit(lines: PostedLine[], code: string, from: string, to: string) {
  return -movement(lines, code, from, to);
}

function typeTotal(lines: PostedLine[], type: PostedLine["accountType"], from: string, to: string) {
  return lines.filter((line) => line.accountType === type && inRange(line.date, from, to)).reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
}

export type { PnlLine };
