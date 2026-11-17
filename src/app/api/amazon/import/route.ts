import { scopeAllows } from "@/lib/spike-auth";
import { auditSpike, authenticateApiKey, SPIKE_BOT } from "@/lib/spike-api";
import { importAmazonReports } from "@/lib/services/amazon-report-import";

export const dynamic = "force-dynamic";

async function textOf(value: FormDataEntryValue | null): Promise<string> {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.text();
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth.ok) {
    await auditSpike("amazon/import", 401, "Rejected Amazon import");
    return Response.json({ error: auth.error }, { status: 401 });
  }
  if (!scopeAllows(auth.scopes, "sales")) {
    await auditSpike("amazon/import", 403, "Amazon import refused. The key needs the sales scope.");
    return Response.json({ error: "This key needs the sales scope to post Amazon reports." }, { status: 403 });
  }
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "").toLowerCase();
  const file = await textOf(form.get("file"));
  const result = await importAmazonReports(SPIKE_BOT, {
    orders: (await textOf(form.get("orders"))) || (kind === "orders" ? file : ""),
    payments: (await textOf(form.get("payments"))) || (kind === "payments" ? file : ""),
    settlement: (await textOf(form.get("settlement"))) || (kind === "settlement" ? file : ""),
    fba: (await textOf(form.get("fba"))) || (kind === "fba" ? file : ""),
  });
  await auditSpike("amazon/import", result.ok ? 200 : 400, result.ok ? result.value.sentence : result.error);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json(result.value);
}
