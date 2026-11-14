import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatQty, usd } from "@/lib/format";
import { lotQty, stockBuckets, valueCents } from "@/lib/inventory";
import { currentStock } from "@/lib/read-models";
import { QC_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const today = todayInput();
  const [products, stock] = await Promise.all([
    prisma.product.findMany({ where: { trackInventory: true }, orderBy: { name: "asc" } }),
    currentStock(),
  ]);
  const needle = query.q.toLowerCase();
  const rows = products.filter((product) => !needle || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle));
  return (
    <>
      <h1>Inventory</h1>
      <p className="lede">On-hand quantity is the sum of lot movements. Reports use that same sum.</p>
      <Flash error={query.error} notice={query.notice} />
      <form>
        <label className="field">Search<input name="q" defaultValue={query.q} /></label>
        <button className="btn secondary" type="submit">Search</button>
      </form>
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th>Ready</th><th>Waiting</th><th>Value</th></tr></thead>
        <tbody>
          {rows.map((product) => {
            const buckets = stockBuckets(stock, product.id, today);
            return (
              <tr key={product.id}>
                <td><Link href={`/products/${product.id}`}>{product.sku}</Link> {product.name}</td>
                <td>{formatQty(buckets.available, product.unit)}</td>
                <td>{formatQty(buckets.quarantine, product.unit)}</td>
                <td>{usd(buckets.valueCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <h2>Lots</h2>
      <div className="wrap"><table>
        <thead><tr><th>Lot</th><th>Product</th><th>Status</th><th>On hand</th><th>Value</th></tr></thead>
        <tbody>
          {stock.filter((lot) => lotQty(lot) > 0).map((lot) => {
            const product = products.find((item) => item.id === lot.productId);
            return (
              <tr key={lot.lotId}>
                <td><Link href={`/inventory/${lot.lotId}`}>{lot.lotNumber}</Link></td>
                <td>{product?.name}</td>
                <td>{QC_LABEL[lot.qcStatus]}</td>
                <td>{formatQty(lotQty(lot), product?.unit)}</td>
                <td>{usd(valueCents(lotQty(lot), lot.unitCost))}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}
