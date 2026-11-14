import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { NSF_LISTED_AS_OF, NSF_LISTING_SOURCE } from "@/lib/nsf-listings";
import { linkNsfAction, refreshNsfListing } from "@/server/extra-actions";

export const dynamic = "force-dynamic";

export default async function NsfPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const [listings, products] = await Promise.all([
    prisma.nsfListing.findMany({ orderBy: [{ category: "asc" }, { tradeName: "asc" }], include: { products: true } }),
    prisma.product.findMany({ where: { kind: "FINISHED" }, orderBy: { name: "asc" }, include: { nsfListing: true } }),
  ]);
  return (
    <>
      <h1>NSF/ANSI/CAN 60 listing</h1>
      <p className="lede">
        These trade names were read from NSF's public listing for SPER Chemical on {NSF_LISTED_AS_OF}. The mark is shown only on a product linked to one of these names.
        Source: {NSF_LISTING_SOURCE}
      </p>
      <Flash error={query.error} notice={query.notice} />
      <form action={refreshNsfListing}><button className="btn secondary" type="submit">Reload the saved public listing</button></form>
      <div className="wrap"><table>
        <thead><tr><th>Trade name</th><th>Category</th><th>Max use</th><th>Linked products</th></tr></thead>
        <tbody>
          {listings.map((row) => (
            <tr key={row.id}>
              <td>{row.tradeName}</td>
              <td>{row.category}</td>
              <td>{Number(row.maxUseMgL)} mg/L</td>
              <td>{row.products.map((product) => product.sku).join(", ") || "None"}</td>
            </tr>
          ))}
          {listings.length === 0 && <tr><td colSpan={4}>No listing is loaded. Use the button above after the seed, or the public site could not be read.</td></tr>}
        </tbody>
      </table></div>
      <h2>Link a product</h2>
      <form action={linkNsfAction}>
        <label className="field">Product
          <select name="productId">{products.map((product) => <option key={product.id} value={product.id}>{product.name} {product.nsfListing ? `(${product.nsfListing.tradeName})` : ""}</option>)}</select>
        </label>
        <label className="field">Trade name on the NSF list
          <select name="listingId">
            <option value="">Not listed — hide the mark</option>
            {listings.map((row) => <option key={row.id} value={row.id}>{row.tradeName} · {Number(row.maxUseMgL)} mg/L</option>)}
          </select>
        </label>
        <button className="btn" type="submit">Save the link</button>
      </form>
    </>
  );
}
