import { auditSpike, authenticateApiKey, callSpike } from "@/lib/spike-api";

export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const joined = path.join("/");
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth.ok) {
    await auditSpike(joined, 401, `Rejected ${request.method} /api/v1/${joined}`);
    return Response.json({ error: auth.error }, { status: 401 });
  }
  const body = request.method === "GET" || request.method === "HEAD" ? {} : await request.json().catch(() => ({}));
  const result = await callSpike(request.method, joined, query, body, auth.scopes);
  await auditSpike(joined, result.status, `${request.method} /api/v1/${joined} -> ${result.status}`);
  if (result.pdf) {
    return new Response(Buffer.from(result.pdf), {
      status: result.status,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${result.filename ?? "document.pdf"}"`,
      },
    });
  }
  return Response.json(result.body, { status: result.status });
}

export { handle as GET, handle as POST, handle as PATCH };
