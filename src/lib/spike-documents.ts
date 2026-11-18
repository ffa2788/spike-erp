import { usd } from "./format";

export function documentHtml(input: {
  title: string;
  number: string;
  party: string;
  lines: { description: string; qty: string; amount: string }[];
  total: string;
  note: string;
}): string {
  const rows = input.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td style="text-align:right">${escapeHtml(line.qty)}</td><td style="text-align:right">${escapeHtml(line.amount)}</td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Helvetica, Arial, sans-serif; color: #0f2b46; }
    h1 { font-size: 22px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
  </style></head><body>
    <h1>${escapeHtml(input.title)} ${escapeHtml(input.number)}</h1>
    <p>${escapeHtml(input.party)}</p>
    <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="num"><strong>Total ${escapeHtml(input.total)}</strong></p>
    <p>${escapeHtml(input.note)}</p>
  </body></html>`;
}

export function money(cents: number): string {
  return usd(cents);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
