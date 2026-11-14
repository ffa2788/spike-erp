import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { generateDocAction } from "@/server/extra-actions";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const q = query.q.toLowerCase();
  const [docs, products] = await Promise.all([
    prisma.safetyDocument.findMany({ include: { product: true }, orderBy: { revisionOn: "desc" } }),
    prisma.product.findMany({ where: { kind: "FINISHED", active: true }, orderBy: { name: "asc" } }),
  ]);
  const rows = docs.filter((doc) => !q || `${doc.title} ${doc.product.name} ${doc.number}`.toLowerCase().includes(q));
  return (
    <>
      <h1>TDS and SDS library</h1>
      <p className="lede">A new sheet is a draft. It is not released until a qualified person reviews it and you publish it.</p>
      <Flash error={query.error} notice={query.notice} />
      <form>
        <label className="field">Search<input name="q" defaultValue={query.q} /></label>
        <button className="btn secondary">Search</button>
      </form>
      <form action={generateDocAction} className="grid-2">
        <label className="field">Product
          <select name="productId" required>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <label className="field">Kind
          <select name="kind"><option value="TDS">Technical data sheet</option><option value="SDS">Safety data sheet</option></select>
        </label>
        <button className="btn" type="submit">Create a draft</button>
      </form>
      <div className="wrap"><table>
        <thead><tr><th>Number</th><th>Product</th><th>Kind</th><th>Version</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>
          {rows.map((doc) => (
            <tr key={doc.id}>
              <td><Link href={`/documents/${doc.id}`}>{doc.number}</Link></td>
              <td>{doc.product.name}</td>
              <td>{doc.kind}</td>
              <td>{doc.version}</td>
              <td>{doc.status === "DRAFT" ? "Draft — needs review" : doc.status === "REVIEWED" ? "Reviewed" : "Published"}</td>
              <td>{formatDate(doc.revisionOn)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
