import { Flash, readQuery } from "@/components/ui";
import { rollUpCost } from "@/lib/costing";
import { prisma } from "@/lib/db";
import { usdPrecise } from "@/lib/format";
import { batchCreate } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function NewBatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const products = await prisma.product.findMany({ where: { kind: "FINISHED", active: true }, orderBy: { name: "asc" } });
  const formulas = await prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } });
  const costProducts = products.concat(await prisma.product.findMany({ where: { kind: { not: "FINISHED" } } })).map((product) => ({
    id: product.id, sku: product.sku, name: product.name, kind: product.kind, standardCost: Number(product.standardCost),
  }));
  const costFormulas = formulas.map((formula) => ({
    productId: formula.productId,
    isDefault: true,
    lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
  }));
  return (
    <>
      <h1>Plan a batch</h1>
      <Flash error={query.error} />
      <form action={batchCreate}>
        <label className="field">Product
          <select name="productId" required>
            <option value="">Choose</option>
            {products.map((product) => {
              const rolled = rollUpCost(product.id, costProducts, costFormulas);
              const label = rolled.status === "OK" && rolled.costPerUnit != null
                ? `${product.name} — recipe ${usdPrecise(rolled.costPerUnit)}/${product.unit}`
                : `${product.name} — recipe cost not usable`;
              return <option key={product.id} value={product.id}>{label}</option>;
            })}
          </select>
        </label>
        <label className="field">Quantity to make<input name="plannedQty" required /></label>
        <label className="field">Notes<textarea name="notes" /></label>
        <button className="btn" type="submit">Plan the batch</button>
      </form>
    </>
  );
}
