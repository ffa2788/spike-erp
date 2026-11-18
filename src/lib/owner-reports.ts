export type ChannelName = "Direct" | "Amazon FBA" | "Amazon FBM" | "Walmart" | "Export";

export const CHANNELS: ChannelName[] = ["Direct", "Amazon FBA", "Amazon FBM", "Walmart", "Export"];

export function channelName(channel: string, fulfillment: string): ChannelName {
  if (channel === "AMAZON") return fulfillment === "FBM" ? "Amazon FBM" : "Amazon FBA";
  if (channel === "WALMART") return "Walmart";
  if (channel === "EXPORT") return "Export";
  return "Direct";
}

export function periodWindow(input: { kind: "week" | "month" | "custom"; anchor: string; from?: string; to?: string }): {
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  label: string;
} {
  if (input.kind === "custom" && input.from && input.to) {
    const days = Math.max(1, Math.round((Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86400000) + 1);
    const priorTo = addDays(input.from, -1);
    return { from: input.from, to: input.to, priorFrom: addDays(priorTo, 1 - days), priorTo, label: `${input.from} to ${input.to}` };
  }
  if (input.kind === "week") {
    const date = new Date(`${input.anchor.slice(0, 10)}T00:00:00Z`);
    const weekday = date.getUTCDay();
    const monday = addDays(input.anchor.slice(0, 10), weekday === 0 ? -6 : 1 - weekday);
    const sunday = addDays(monday, 6);
    return { from: monday, to: sunday, priorFrom: addDays(monday, -7), priorTo: addDays(monday, -1), label: `Week of ${monday}` };
  }
  const current = monthBounds(input.anchor);
  const [year, month] = input.anchor.slice(0, 7).split("-").map(Number);
  const prior = monthBounds(`${month === 1 ? year - 1 : year}-${pad(month === 1 ? 12 : month - 1)}-01`);
  return { ...current, priorFrom: prior.from, priorTo: prior.to, label: input.anchor.slice(0, 7) };
}

function monthBounds(anchor: string): { from: string; to: string } {
  const [year, month] = anchor.slice(0, 7).split("-").map(Number);
  const from = `${year}-${pad(month)}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
  return { from, to: addDays(next, -1) };
}

export function ytdWindow(anchor: string): { from: string; to: string } {
  const year = anchor.slice(0, 4);
  return { from: `${year}-01-01`, to: anchor.slice(0, 10) };
}

export type MoneyRow = { name: string; currentCents: number; priorCents: number; deltaCents: number };

export function channelSales(current: { channel: string; fulfillment: string; cents: number }[], prior: { channel: string; fulfillment: string; cents: number }[]): MoneyRow[] {
  return CHANNELS.map((name) => {
    const now = sum(current.filter((row) => channelName(row.channel, row.fulfillment) === name).map((row) => row.cents));
    const before = sum(prior.filter((row) => channelName(row.channel, row.fulfillment) === name).map((row) => row.cents));
    return { name, currentCents: now, priorCents: before, deltaCents: now - before };
  });
}

export type ProductRow = { id: string; name: string; qty: number; revenueCents: number; cogsCents: number; marginCents: number; marginPercent: number | null };

export function productSales(lines: { id: string; name: string; qty: number; revenueCents: number; cogsCents: number }[], sort: "revenue" | "margin" | "qty" | "name" = "revenue"): ProductRow[] {
  const map = new Map<string, ProductRow>();
  for (const line of lines) {
    const row = map.get(line.id) ?? { id: line.id, name: line.name, qty: 0, revenueCents: 0, cogsCents: 0, marginCents: 0, marginPercent: null };
    row.qty += line.qty;
    row.revenueCents += line.revenueCents;
    row.cogsCents += line.cogsCents;
    map.set(line.id, row);
  }
  const rows = [...map.values()].map((row) => ({
    ...row,
    marginCents: row.revenueCents - row.cogsCents,
    marginPercent: row.revenueCents > 0 ? Math.round(((row.revenueCents - row.cogsCents) / row.revenueCents) * 1000) / 10 : null,
  }));
  const dir = sort === "name" ? 1 : -1;
  return rows.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "qty") return (a.qty - b.qty) * dir;
    if (sort === "margin") return (a.marginCents - b.marginCents) * dir;
    return (a.revenueCents - b.revenueCents) * dir;
  });
}

export type CustomerRow = { name: string; revenueCents: number; marginCents: number; invoices: number; arCents: number };

export function customerSales(rows: { name: string; revenueCents: number; cogsCents: number; balanceCents: number }[]): CustomerRow[] {
  const map = new Map<string, CustomerRow>();
  for (const row of rows) {
    const current = map.get(row.name) ?? { name: row.name, revenueCents: 0, marginCents: 0, invoices: 0, arCents: 0 };
    current.revenueCents += row.revenueCents;
    current.marginCents += row.revenueCents - row.cogsCents;
    current.invoices += 1;
    current.arCents += row.balanceCents;
    map.set(row.name, current);
  }
  return [...map.values()].sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
}

export type PnlLine = { label: string; month: number; prior: number; ytd: number; kind: "line" | "total" };

export function profitStatement(input: {
  revenue: { name: string; month: number; prior: number; ytd: number }[];
  returns: { month: number; prior: number; ytd: number };
  discounts: { month: number; prior: number; ytd: number };
  cogs: { month: number; prior: number; ytd: number };
  expenses: { name: string; month: number; prior: number; ytd: number }[];
  otherIncome: { month: number; prior: number; ytd: number };
}): PnlLine[] {
  const lines: PnlLine[] = [];
  for (const row of input.revenue) lines.push({ label: row.name, month: row.month, prior: row.prior, ytd: row.ytd, kind: "line" });
  lines.push({ label: "Returns", month: -input.returns.month, prior: -input.returns.prior, ytd: -input.returns.ytd, kind: "line" });
  lines.push({ label: "Discounts", month: -input.discounts.month, prior: -input.discounts.prior, ytd: -input.discounts.ytd, kind: "line" });
  const revenue = fold(lines);
  lines.push({ label: "Net revenue", ...revenue, kind: "total" });
  lines.push({ label: "Cost of goods sold", month: -input.cogs.month, prior: -input.cogs.prior, ytd: -input.cogs.ytd, kind: "line" });
  const gross = { month: revenue.month - input.cogs.month, prior: revenue.prior - input.cogs.prior, ytd: revenue.ytd - input.cogs.ytd };
  lines.push({ label: "Gross profit", ...gross, kind: "total" });
  const expenseLines: PnlLine[] = input.expenses.map((row) => ({ label: row.name, month: -row.month, prior: -row.prior, ytd: -row.ytd, kind: "line" }));
  lines.push(...expenseLines);
  const opex = fold(expenseLines);
  const operating = { month: gross.month + opex.month, prior: gross.prior + opex.prior, ytd: gross.ytd + opex.ytd };
  lines.push({ label: "Operating income", ...operating, kind: "total" });
  lines.push({ label: "Other income", month: input.otherIncome.month, prior: input.otherIncome.prior, ytd: input.otherIncome.ytd, kind: "line" });
  lines.push({
    label: "Net income",
    month: operating.month + input.otherIncome.month,
    prior: operating.prior + input.otherIncome.prior,
    ytd: operating.ytd + input.otherIncome.ytd,
    kind: "total",
  });
  return lines;
}

export function numberGaps(numbers: string[]): number[] {
  const values = numbers.map((value) => Number(value.replace(/\D/g, ""))).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    for (let missing = values[index - 1] + 1; missing < values[index]; missing += 1) gaps.push(missing);
  }
  return gaps;
}

function fold(lines: PnlLine[]): { month: number; prior: number; ytd: number } {
  return lines.reduce((sum, line) => ({ month: sum.month + line.month, prior: sum.prior + line.prior, ytd: sum.ytd + line.ytd }), { month: 0, prior: 0, ytd: 0 });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function pad(month: number): string {
  return String(month).padStart(2, "0");
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
