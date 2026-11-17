import { notFound } from "next/navigation";
import { NsfMark } from "@/components/nsf-mark";
import { PrintButton } from "@/components/print-button";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { buildSds, buildTds, type SdsInput } from "@/lib/sds";
import { publishDocAction, reviewDocAction } from "@/server/extra-actions";

export const dynamic = "force-dynamic";

export async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const doc = await prisma.safetyDocument.findUnique({ where: { id }, include: { product: { include: { nsfListing: true } } } });
  if (!doc) notFound();
  const snapshot = doc.snapshot as { input?: SdsInput & { description?: string } };
  const input = snapshot.input;
  const sds = doc.kind === "SDS" && input ? buildSds(input) : null;
  const tds = doc.kind === "TDS" && input ? buildTds({ ...input, description: input.description ?? "" }) : null;
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print or save as PDF" /></p>
      <Flash error={query.error} notice={query.notice} />
      {doc.status !== "PUBLISHED" && (
        <div className="banner bad">Draft. A qualified person must review this {doc.kind} before it is released. Do not hand this copy to a customer.</div>
      )}
      <h1>{doc.title}</h1>
      <p>{doc.product.name} · version {doc.version} · {doc.status}</p>
      <NsfMark listing={doc.product.nsfListing} />
      {tds && tds.lines.map((line) => (
        <p key={line.label}><strong>{line.label}.</strong> {line.value}</p>
      ))}
      {sds && sds.sections.map((section) => (
        <section key={section.number}>
          <h2>{section.number}. {section.title}</h2>
          {section.body.split("\n").map((line) => <p key={line}>{line}</p>)}
        </section>
      ))}
      {doc.status === "DRAFT" && (
        <form action={reviewDocAction} className="no-print">
          <input type="hidden" name="id" value={doc.id} />
          <label className="field">Qualified review note<textarea name="note" required /></label>
          <button className="btn" type="submit">Record the review</button>
        </form>
      )}
      {doc.status === "REVIEWED" && (
        <form action={publishDocAction} className="no-print">
          <input type="hidden" name="id" value={doc.id} />
          <button className="btn" type="submit">Publish this version</button>
        </form>
      )}
      {doc.reviewedBy && <p>Reviewed by {doc.reviewedBy}. {doc.reviewNote}</p>}
    </article>
  );
}
