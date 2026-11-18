import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { DrawerClose, Screen, one } from "@/components/screen";
import { rollUpCost } from "@/lib/costing";
import { prisma } from "@/lib/db";
import { usdPrecise } from "@/lib/format";
import { KIND_LABEL } from "@/lib/labels";
import { ProductPage } from "./[id]/view";
import { NewProductPage } from "./new/view";
import { FormulaBuilderPage as FormulaPage } from "./[id]/formula/view";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = await readQuery(Promise.resolve(sp));
  const again = Promise.resolve(sp);
  const id = one(sp, "id");
  const formula = one(sp, "formula") === "1";
  const isNew = one(sp, "new") === "1";
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  const formulas = await prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } });
  const costProducts = products.map((product) => ({
    id: product.id, sku: product.sku, name: product.name, kind: product.kind, standardCost: Number(product.standardCost),
  }));
  const costFormulas = formulas.map((item) => ({
    productId: item.productId,
    isDefault: true,
    lines: item.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
  }));
  const needle = query.q.toLowerCase();
  const drawer = formula && id
    ? <FormulaPage params={Promise.resolve({ id })} searchParams={again} />
    : id
      ? <ProductPage params={Promise.resolve({ id })} searchParams={again} />
      : isNew
        ? <NewProductPage searchParams={again} />
        : null;
  return (
    <Screen
      title="Products and formulas"
      lede="One product, one SKU. Open a formula in the side panel."
      primary={formula ? undefined : { href: "/products?new=1", label: "New product" }}
      wide={formula}
      drawer={drawer ? <><DrawerClose href="/products" />{drawer}</> : undefined}
    >
      <Flash error={query.error} notice={query.notice} />
      <form>
        <label className="field">Search<input name="q" defaultValue={query.q} /></label>
        <button className="btn secondary">Search</button>
      </form>
      <div className="wrap"><table>
        <thead><tr><th>SKU</th><th>Name</th><th>Kind</th><th className="num">Cost</th><th className="num">Price</th><th></th></tr></thead>
        <tbody>
          {products.filter((product) => !needle || `${product.sku} ${product.name}`.toLowerCase().includes(needle)).map((product) => {
            const rolled = product.kind === "FINISHED" ? rollUpCost(product.id, costProducts, costFormulas) : null;
            const cost = product.kind === "FINISHED"
              ? rolled?.status === "OK" && rolled.costPerUnit != null ? usdPrecise(rolled.costPerUnit) : "Not usable"
              : Number(product.standardCost) > 0 ? usdPrecise(Number(product.standardCost)) : "No cost";
            const price = product.priceStatus === "CONFIRMED" && product.listPrice != null ? usdPrecise(Number(product.listPrice)) : product.priceStatus === "PLACEHOLDER" ? "Placeholder blocked" : "Not set";
            return (
              <tr key={product.id}>
                <td><Link href={`/products?id=${product.id}`}>{product.sku}</Link></td>
                <td>{product.name}</td>
                <td>{KIND_LABEL[product.kind]}</td>
                <td className="num">{cost}</td>
                <td className="num">{price}</td>
                <td>{product.kind !== "PACKAGING" ? <Link href={`/products?formula=1&id=${product.id}`}>Formula</Link> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </Screen>
  );
}
