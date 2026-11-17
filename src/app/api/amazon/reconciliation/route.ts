import { reconciliationPdf } from "@/lib/amazon-reconcile";
import { loadAmazonReconciliation } from "@/lib/services/amazon-report-import";
import { auditSpike, authenticateApiKey } from "@/lib/spike-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth.ok) {
    await auditSpike("amazon/reconciliation", 401, "Rejected Amazon reconciliation");
    return Response.json({ error: auth.error }, { status: 401 });
  }
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "";
  const result = await loadAmazonReconciliation(period);
  await auditSpike("amazon/reconciliation", result.ok ? 200 : 400, result.ok ? `Amazon reconciliation ${period}` : result.error);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  if (url.searchParams.get("format") === "pdf") {
    const pdf = await reconciliationPdf(result.value);
    return new Response(Buffer.from(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="amazon-${period}.pdf"` },
    });
  }
  return Response.json(result.value);
}
