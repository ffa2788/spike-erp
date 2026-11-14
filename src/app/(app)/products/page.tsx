import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { rollUpCost } from "@/lib/costing";
import { prisma } from "@/lib/db";
import { usdPrecise } from "@/lib/format";
import { KIND_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  const formulas = await prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } });
  const costProducts = products.map((product) => ({
    id: product.id, sku: product.sku, name: product.name, kind: product.kind, standardCost: Number(product.standardCost),
  }));
  const costFormulas = formulas.map((formula) => ({
    productId: formula.productId,
    isDefault: true,
    lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
  }));
  const needle = query.q.toLowerCase();
  return (
    <>
      <div className="row"><h1>Products</h1><Link className="btn" href="/products/new">New product</Link></div>
      <p className="lede">One product, one SKU. Recipe cost includes sub-recipes, or it is shown as not usable.</p>
      <Flash error={query.error} notice={query.notice} />
      <form><label className="field">Search<input name="q" defaultValue={query.q} /></label><button className="btn secondary">Search</button></form>
      <div className="wrap"><table>
        <thead><tr><th>SKU</th><th>Name</th><th>Kind</th><th>Cost</th><th>Price</th></tr></thead>
        <tbody>
          {products.filter((product) => !needle || `${product.sku} ${product.name}`.toLowerCase().includes(needle)).map((product) => {
            const rolled = product.kind === "FINISHED" ? rollUpCost(product.id, costProducts, costFormulas) : null;
            const cost = product.kind === "FINISHED"
              ? rolled?.status === "OK" && rolled.costPerUnit != null ? usdPrecise(rolled.costPerUnit) : "Not usable"
              : Number(product.standardCost) > 0 ? usdPrecise(Number(product.standardCost)) : "No cost";
            const price = product.priceStatus === "CONFIRMED" && product.listPrice != null ? usdPrecise(Number(product.listPrice)) : product.priceStatus === "PLACEHOLDER" ? "Placeholder blocked" : "Not set";
            return (
              <tr key={product.id}>
                <td><Link href={`/products/${product.id}`}>{product.sku}</Link></td>
                <td>{product.name}</td>
                <td>{KIND_LABEL[product.kind]}</td>
                <td>{cost}</td>
                <td>{price}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}
