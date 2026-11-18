import type { PnlLine } from "./owner-reports";

export type StatementRow = {
  key: string;
  label: string;
  month: number;
  prior: number;
  ytd: number;
  role: "header" | "detail" | "total" | "note";
  rule?: "above" | "double";
  dollar?: boolean;
  net?: boolean;
};

const NAMED = new Set([
  "Direct",
  "Amazon FBA",
  "Amazon FBM",
  "Walmart",
  "Export",
  "Returns",
  "Discounts",
  "Net revenue",
  "Cost of goods sold",
  "Gross profit",
  "Operating income",
  "Other income",
  "Net income",
]);

export function statementMoney(cents: number, dollar: boolean): string {
  const body = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = dollar ? `$${body}` : body;
  return cents < 0 ? `(${text})` : text;
}

export function statementTitle(from: string, to: string): string {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  const month = start.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth() && start.getUTCDate() === 1 && end.getUTCDate() === last) {
    return `${month} 1 – ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  const left = start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const right = end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${left} – ${right}`;
}

export function statementColumns(from: string, priorFrom: string): { month: string; prior: string; ytd: string } {
  const label = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return { month: label(from), prior: label(priorFrom), ytd: "YTD" };
}

export function presentProfit(rows: PnlLine[]): StatementRow[] {
  const find = (label: string) => rows.find((row) => row.label === label);
  const out: StatementRow[] = [{ key: "income", label: "Income", month: 0, prior: 0, ytd: 0, role: "header" }];
  let firstDollar = true;
  for (const name of ["Direct", "Amazon FBA", "Amazon FBM", "Walmart", "Export"]) {
    const row = find(name);
    if (!row || (row.month === 0 && row.prior === 0 && row.ytd === 0)) continue;
    out.push({ key: name, label: name, month: row.month, prior: row.prior, ytd: row.ytd, role: "detail", dollar: firstDollar });
    firstDollar = false;
  }
  out.push({ key: "less", label: "Less returns and discounts", month: 0, prior: 0, ytd: 0, role: "header" });
  for (const name of ["Returns", "Discounts"]) {
    const row = find(name);
    if (!row) continue;
    out.push({ key: name, label: name, month: row.month, prior: row.prior, ytd: row.ytd, role: "detail" });
  }
  const net = find("Net revenue");
  const cogs = find("Cost of goods sold");
  const gross = find("Gross profit");
  const operating = find("Operating income");
  const other = find("Other income");
  const bottom = find("Net income");
  if (net) out.push({ key: "net-revenue", label: "Net revenue", month: net.month, prior: net.prior, ytd: net.ytd, role: "total", rule: "above", dollar: true });
  if (cogs) out.push({ key: "cogs", label: "Cost of goods sold", month: cogs.month, prior: cogs.prior, ytd: cogs.ytd, role: "detail" });
  if (gross) {
    out.push({ key: "gross", label: "Gross profit", month: gross.month, prior: gross.prior, ytd: gross.ytd, role: "total", dollar: true });
    const percent = net && net.month !== 0 ? Math.round((gross.month / net.month) * 1000) / 10 : null;
    out.push({
      key: "margin",
      label: percent == null ? "" : `${percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}% of net revenue`,
      month: 0,
      prior: 0,
      ytd: 0,
      role: "note",
    });
  }
  const expenses = rows.filter((row) => !NAMED.has(row.label)).slice().sort((a, b) => expenseRank(a.label) - expenseRank(b.label) || a.label.localeCompare(b.label));
  out.push({ key: "opex", label: "Operating expenses", month: 0, prior: 0, ytd: 0, role: "header" });
  for (const row of expenses) {
    out.push({ key: row.label, label: cleanExpense(row.label), month: row.month, prior: row.prior, ytd: row.ytd, role: "detail" });
  }
  const total = expenses.reduce((sum, row) => ({ month: sum.month + row.month, prior: sum.prior + row.prior, ytd: sum.ytd + row.ytd }), { month: 0, prior: 0, ytd: 0 });
  out.push({ key: "opex-total", label: "Total operating expenses", ...total, role: "total", dollar: true });
  if (operating) out.push({ key: "operating", label: "Operating income", month: operating.month, prior: operating.prior, ytd: operating.ytd, role: "total", dollar: true });
  if (other) out.push({ key: "other", label: "Other income", month: other.month, prior: other.prior, ytd: other.ytd, role: "detail" });
  if (bottom) out.push({ key: "net", label: "Net income", month: bottom.month, prior: bottom.prior, ytd: bottom.ytd, role: "total", rule: "double", dollar: true, net: true });
  return out;
}

export function profitHtml(input: { title: string; columns: { month: string; prior: string; ytd: string }; rows: StatementRow[] }): string {
  const body = input.rows.map((row) => {
    if (row.role === "header") return `<tr class="header"><td colspan="4">${escapeHtml(row.label)}</td></tr>`;
    if (row.role === "note") return `<tr class="note"><td colspan="4">${escapeHtml(row.label)}</td></tr>`;
    const cls = ["line", row.role, row.rule === "above" ? "rule" : "", row.rule === "double" ? "double" : "", row.net ? "net" : ""].filter(Boolean).join(" ");
    const line = `<tr class="${cls}"><td>${escapeHtml(row.label)}</td><td class="${row.net && row.month < 0 ? "neg" : ""}">${statementMoney(row.month, Boolean(row.dollar))}</td><td class="${row.net && row.prior < 0 ? "neg" : ""}">${statementMoney(row.prior, Boolean(row.dollar))}</td><td class="${row.net && row.ytd < 0 ? "neg" : ""}">${statementMoney(row.ytd, Boolean(row.dollar))}</td></tr>`;
    return row.rule === "double" ? `${line}<tr class="close"><td colspan="4"></td></tr>` : line;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Profit and Loss</title><style>${PNL_CSS}</style></head><body>
    <header><div class="company">SPER Chemical Corporation</div><div class="doc">Profit and Loss</div><div class="period">${escapeHtml(input.title)}</div><div class="example">Example data</div></header>
    <table><thead><tr><th></th><th>${escapeHtml(input.columns.month)}</th><th>${escapeHtml(input.columns.prior)}</th><th>${escapeHtml(input.columns.ytd)}</th></tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
}

const PNL_CSS = `
  @page { size: letter portrait; margin: 0.6in 0.7in 0.75in; }
  body { margin: 0; color: #1a1a1a; font-family: Inter, Helvetica, Arial, sans-serif; font-size: 12px; }
  header { text-align: center; margin-bottom: 22px; }
  .company { font-size: 16px; font-weight: 650; letter-spacing: 0.01em; }
  .doc { font-size: 14px; font-weight: 650; margin-top: 2px; }
  .period { margin-top: 2px; }
  .example { margin-top: 6px; color: #667085; font-size: 10px; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
  th { text-align: right; font-weight: 650; font-size: 11px; padding: 0 0 8px; border-bottom: 1px solid #1a1a1a; }
  th:first-child { text-align: left; }
  td { padding: 5px 0; vertical-align: baseline; }
  td:nth-child(n+2) { text-align: right; width: 7.2rem; }
  tr.header td { padding-top: 14px; font-weight: 650; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #344054; }
  tr.detail td:first-child { padding-left: 16px; }
  tr.total td { font-weight: 700; }
  tr.rule td { border-top: 1px solid #1a1a1a; }
  tr.double td { border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; font-size: 14px; padding-top: 8px; padding-bottom: 3px; }
  tr.close td { border-bottom: 1px solid #1a1a1a; padding: 3px 0 0; line-height: 0; font-size: 0; }
  tr.note td { color: #667085; font-size: 10px; padding-top: 0; padding-left: 16px; }
  .neg { color: #9f3a3a; }
`;

function expenseRank(label: string): number {
  const text = label.toLowerCase();
  if (text.includes("amazon")) return 10;
  if (text.includes("wage") || text.includes("payroll")) return 20;
  if (text.includes("freight")) return 30;
  if (text.includes("rent")) return 40;
  if (text.includes("utilit")) return 50;
  return 60;
}

function cleanExpense(label: string): string {
  return label.replace(/^\d+\s+/, "");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}
