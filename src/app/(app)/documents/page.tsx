import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { DrawerClose, Screen, one } from "@/components/screen";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { generateDocAction } from "@/server/extra-actions";
import { DocumentPage } from "./[id]/view";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = await readQuery(Promise.resolve(sp));
  const id = one(sp, "id");
  const q = query.q.toLowerCase();
  const [docs, products] = await Promise.all([
    prisma.safetyDocument.findMany({ include: { product: true }, orderBy: { revisionOn: "desc" } }),
    prisma.product.findMany({ where: { kind: "FINISHED", active: true }, orderBy: { name: "asc" } }),
  ]);
  const rows = docs.filter((doc) => !q || `${doc.title} ${doc.product.name} ${doc.number}`.toLowerCase().includes(q));
  return (
    <Screen
      title="Documents"
      lede="Technical data sheets, safety data sheets, and certificates. A new sheet stays a draft until someone qualified publishes it."
      drawer={id ? <><DrawerClose href="/documents" /><DocumentPage params={Promise.resolve({ id })} searchParams={Promise.resolve(sp)} /></> : undefined}
    >
      <Flash error={query.error} notice={query.notice} />
      <form className="search-line">
        <label className="field">Search<input name="q" defaultValue={query.q} /></label>
        <button className="btn secondary">Search</button>
      </form>
      <form action={generateDocAction} className="grid-2">
        <label className="field">Product
          <select name="productId">{products.map((product) => <option key={product.id} value={product.id}>{product.sku} {product.name}</option>)}</select>
        </label>
        <label className="field">Kind
          <select name="kind"><option value="SDS">SDS</option><option value="TDS">TDS</option></select>
        </label>
        <button className="btn" type="submit">Create a draft</button>
      </form>
      <div className="wrap"><table>
        <thead><tr><th>Number</th><th>Title</th><th>Product</th><th>Status</th><th>Revised</th></tr></thead>
        <tbody>
          {rows.map((doc) => (
            <tr key={doc.id}>
              <td><Link href={`/documents?id=${doc.id}`}>{doc.number}</Link></td>
              <td>{doc.title}</td>
              <td>{doc.product.name}</td>
              <td><span className={`chip ${doc.status === "PUBLISHED" ? "good" : "warn"}`}>{doc.status}</span></td>
              <td>{formatDate(doc.revisionOn)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Screen>
  );
}
