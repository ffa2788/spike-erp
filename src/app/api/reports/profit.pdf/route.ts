import { cookies } from "next/headers";
import { readToken } from "@/lib/session-token";
import { usd } from "@/lib/format";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { profitReport } from "@/lib/services/owner-reports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const jar = await cookies();
  const session = await readToken(jar.get("spike_session")?.value);
  if (!session) return new Response("Sign in first.", { status: 401 });
  const url = new URL(request.url);
  const report = await profitReport({
    period: url.searchParams.get("period") ?? "month",
    anchor: url.searchParams.get("anchor") ?? "2026-10-15",
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  const rows = report.rows.map((row) => `<tr><td>${escape(row.label)}</td><td>${usd(row.month)}</td><td>${usd(row.prior)}</td><td>${usd(row.ytd)}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Profit ${report.window.label}</title>
    <style>body{font-family:Inter,Helvetica,Arial,sans-serif;color:#0f2b46;padding:32px}h1{font-weight:650}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #e6e8ec}td:nth-child(n+2),th:nth-child(n+2){text-align:right;font-variant-numeric:tabular-nums}p{color:#475467}</style>
    </head><body><h1>Profit · ${escape(report.window.label)}</h1><p>Example data. These are not real sales or costs.</p>
    <table><thead><tr><th></th><th>This period</th><th>Prior period</th><th>Year to date</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const pdf = await htmlToPdf(html);
  return new Response(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"profit.pdf\"" },
  });
}

function escape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}
