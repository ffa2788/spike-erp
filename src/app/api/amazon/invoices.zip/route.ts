import { cookies } from "next/headers";
import { invoiceZip } from "@/lib/services/amazon-week";
import { readToken } from "@/lib/session-token";
import { authenticateApiKey } from "@/lib/spike-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const session = await readToken((await cookies()).get("spike_session")?.value);
  if (header) {
    const auth = await authenticateApiKey(header);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });
  } else if (!session) {
    return Response.json({ error: "Sign in, or send the SPIKE bot key." }, { status: 401 });
  }
  const period = url.searchParams.get("period") ?? "";
  const zip = await invoiceZip(period);
  if (!zip) return Response.json({ error: `No invoice PDFs are stored for ${period}.` }, { status: 404 });
  return new Response(Buffer.from(zip.bytes), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${zip.filename}"` },
  });
}
