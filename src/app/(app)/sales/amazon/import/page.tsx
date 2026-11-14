import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { suggestAmazonSku } from "@/lib/amazon-reports";
import { importFbaAction, importOrdersAction, mapAmazonSkuAction } from "@/server/amazon-file-actions";

export const dynamic = "force-dynamic";

export default async function AmazonImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const [products, maps, unmappedItems] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.amazonSkuMap.findMany({ include: { product: true }, orderBy: { amazonSku: "asc" } }),
    prisma.amazonOrderItem.findMany({ where: { productId: null, cancelled: false }, orderBy: { sku: "asc" } }),
  ]);
  const unmapped = new Map<string, { sku: string; asin: string }>();
  for (const row of unmappedItems) unmapped.set(row.sku, { sku: row.sku, asin: row.asin });
  for (const row of maps) if (!row.productId) unmapped.set(row.amazonSku, { sku: row.amazonSku, asin: row.asin });
  return (
    <>
      <h1>Amazon file import</h1>
      <p className="lede">
        Upload Amazon's own tab-delimited Seller Central reports for the US marketplace. This is the path to use until Selling Partner API access is approved.
        Buyer names and identification numbers are not stored. Only ship-to city, state, and ZIP are kept.
      </p>
      <Flash error={query.error} notice={query.notice} />
      <p><Link href="/sales/amazon">Amazon connection</Link></p>
      <h2>All Orders</h2>
      <p>One row per item. You can upload several 30-day files. The same order item keeps the newer last-updated date. Cancelled rows are not sales. Shipped rows that map to a product become A- invoices and count in the production schedule.</p>
      <form action={importOrdersAction}>
        <label className="field">Report file<input type="file" name="file" accept=".txt,.tsv,.csv" /></label>
        <label className="field">Or paste<textarea name="csv" /></label>
        <button className="btn" type="submit">Import orders</button>
      </form>
      <h2>Manage FBA Inventory</h2>
      <p>Fulfillable stock is the available column. Inbound is inbound-working plus inbound-shipped plus inbound-received. Those quantities feed the production schedule.</p>
      <form action={importFbaAction}>
        <label className="field">Report file<input type="file" name="file" accept=".txt,.tsv,.csv" /></label>
        <label className="field">Or paste<textarea name="csv" /></label>
        <button className="btn" type="submit">Import FBA inventory</button>
      </form>
      <h2>Import summary</h2>
      {query.notice ? <p>{query.notice}</p> : <p>No file imported in this visit yet.</p>}
      <h2>SKU mapping</h2>
      <p>Amazon SKUs are matched after trimming spaces at the ends. A space in the middle, as in "SC-RP1-1.0-1 -FBA", is kept. Unmapped rows stay on this list.</p>
      <div className="wrap"><table>
        <thead><tr><th>Amazon SKU</th><th>ASIN</th><th>Suggestion</th><th>SPIKE product</th></tr></thead>
        <tbody>
          {[...unmapped.values()].map((row) => {
            const suggestion = suggestAmazonSku({ sku: row.sku, asin: row.asin, products });
            return (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.asin}</td>
                <td>{suggestion.label || "No suggestion"}</td>
                <td>
                  <form action={mapAmazonSkuAction} className="row">
                    <input type="hidden" name="amazonSku" value={row.sku} />
                    <select name="productId" defaultValue={suggestion.productId ?? ""}>
                      <option value="">Choose</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.sku} {product.name}</option>)}
                    </select>
                    <button className="btn secondary" type="submit">Map</button>
                  </form>
                </td>
              </tr>
            );
          })}
          {unmapped.size === 0 && <tr><td colSpan={4}>No unmapped SKUs.</td></tr>}
        </tbody>
      </table></div>
      <h2>Mapped SKUs</h2>
      <ul>
        {maps.filter((row) => row.product).map((row) => <li key={row.id}>{row.amazonSku} → {row.product?.sku} {row.product?.name}</li>)}
      </ul>
    </>
  );
}
