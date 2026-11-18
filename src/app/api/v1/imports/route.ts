import { auditSpike, authenticateApiKey } from "@/lib/spike-api";
import { canImport } from "@/lib/spike-auth";
import { commitBundle, describeBundle, textOfUpload } from "@/lib/services/import-bundle";
import { SPIKE_BOT } from "@/lib/spike-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth.ok) {
    await auditSpike("imports", 401, "Rejected POST /api/v1/imports");
    return Response.json({ error: auth.error }, { status: 401 });
  }
  if (!canImport(auth.scopes)) {
    await auditSpike("imports", 403, "POST /api/v1/imports needs sales or import");
    return Response.json({ error: "This key needs the sales or import scope." }, { status: 403 });
  }
  const form = await request.formData();
  const dry = form.get("dryRun") === "true" || new URL(request.url).searchParams.get("dryRun") === "true";
  const uploads = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (!uploads.length) return Response.json({ error: "Send one or more files in the files field." }, { status: 400 });
  const files = await Promise.all(uploads.map(async (file) => ({ name: file.name, csv: await textOfUpload(file), kind: "" })));
  const preview = await describeBundle(files);
  if (dry) {
    await auditSpike("imports", 200, `Dry run of ${files.length} import file(s).`);
    return Response.json({
      dryRun: true,
      okRows: preview.okRows,
      files: preview.files.map((file) => ({ name: file.name, kind: file.kind, ready: file.ready })),
      errors: preview.errorRows,
      checks: preview.checks,
    });
  }
  const result = await commitBundle(SPIKE_BOT, preview.files.map((file) => ({ name: file.name, csv: file.csv, kind: file.kind })));
  await auditSpike("imports", result.ok ? 200 : 422, result.ok ? `Imported ${result.value.saved} cutover rows.` : result.error);
  if (!result.ok) return Response.json({ error: result.error, checks: preview.checks }, { status: 422 });
  return Response.json({ saved: result.value.saved, notes: result.value.notes, checks: preview.checks });
}
