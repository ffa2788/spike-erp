import { cookies } from "next/headers";
import { readToken } from "@/lib/session-token";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { presentProfit, profitHtml, statementColumns, statementTitle } from "@/lib/pnl-present";
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
  const html = profitHtml({
    title: statementTitle(report.window.from, report.window.to),
    columns: statementColumns(report.window.from, report.window.priorFrom),
    rows: presentProfit(report.rows),
  });
  const generated = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const pdf = await htmlToPdf(html, { footerDate: generated });
  return new Response(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"profit.pdf\"" },
  });
}
