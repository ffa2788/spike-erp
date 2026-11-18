import { cookies } from "next/headers";
import { readToken } from "@/lib/session-token";
import { productReport } from "@/lib/services/owner-reports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const jar = await cookies();
  const session = await readToken(jar.get("spike_session")?.value);
  if (!session) return new Response("Sign in first.", { status: 401 });
  const url = new URL(request.url);
  const report = await productReport({
    period: url.searchParams.get("period") ?? "month",
    anchor: url.searchParams.get("anchor") ?? "2026-10-15",
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    sort: url.searchParams.get("sort") ?? "revenue",
  });
  const lines = ["sku,units,revenue_cents,cogs_cents,margin_cents,margin_percent"];
  for (const row of report.rows) {
    lines.push([csv(row.name), row.qty, row.revenueCents, row.cogsCents, row.marginCents, row.marginPercent ?? ""].join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"sales-by-product.csv\"",
    },
  });
}

function csv(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
