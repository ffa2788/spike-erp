import Link from "next/link";
import { notFound } from "next/navigation";
import { FormulaBuilder } from "@/components/formula-builder";
import { Flash, readQuery } from "@/components/ui";
import { rollUpCost } from "@/lib/costing";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { usdPrecise } from "@/lib/format";
import { PACKAGE_PRESETS, contentsWeightLb, packagedCost } from "@/lib/formula-math";
import { packAction } from "@/server/extra-actions";

export const dynamic = "force-dynamic";

export async function FormulaBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const query = await readQuery(Promise.resolve(raw));
  const pack = typeof raw.pack === "string" ? raw.pack : "";
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      formulas: { include: { lines: { include: { ingredient: true } } }, orderBy: { version: "desc" } },
      nsfListing: true,
    },
  });
  if (!product) notFound();
  const asPackage = await prisma.packagedSku.findUnique({ where: { outputProductId: id } });
  const recipe = asPackage && asPackage.productId !== id
    ? await prisma.product.findUnique({
        where: { id: asPackage.productId },
        include: { formulas: { include: { lines: { include: { ingredient: true } } }, orderBy: { version: "desc" } } },
      })
    : product;
  if (!recipe) notFound();
  const [products, formulas, packages] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } }),
    prisma.packagedSku.findMany({
      where: { productId: recipe.id },
      include: { lines: { include: { material: true } }, outputProduct: true },
    }),
  ]);
  const current = recipe.formulas.find((formula) => formula.isDefault) ?? recipe.formulas[0];
  const costProducts = products.map((item) => ({ id: item.id, sku: item.sku, name: item.name, kind: item.kind, standardCost: Number(item.standardCost) }));
  const costFormulas = formulas.map((formula) => ({
    productId: formula.productId,
    isDefault: formula.isDefault,
    lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
  }));
  const costOf = (ingredientId: string) => {
    const rolled = rollUpCost(ingredientId, costProducts, costFormulas);
    if (rolled.status === "OK" && rolled.costPerUnit != null) return rolled.costPerUnit;
    return Number(products.find((item) => item.id === ingredientId)?.standardCost) || 0;
  };
  const form = product.form === "POWDER" ? "POWDER" : "LIQUID";
  const presets = PACKAGE_PRESETS.filter((preset) => preset.form === form);
  const selected = presets.find((preset) => preset.code === pack) ?? presets.find((preset) => preset.code === asPackage?.packageCode) ?? presets[0];
  const gravity = current?.specificGravity != null ? Number(current.specificGravity) : recipe.specificGravity != null ? Number(recipe.specificGravity) : null;
  const contentsLb = selected ? contentsWeightLb({ form, gallons: selected.gallons, netLb: selected.netLb, specificGravity: gravity }) : null;
  const chosenPackage = selected ? packages.find((item) => item.packageCode === selected.code) : undefined;
  const rolled = rollUpCost(recipe.id, costProducts, costFormulas);
  const cost = packagedCost({
    contentsCostPerLb: rolled.costPerUnit,
    contentsLb: contentsLb ?? 0,
    gallons: selected?.gallons,
    unitsPerCase: chosenPackage?.unitsPerCase ?? 1,
    casesPerPallet: chosenPackage?.casesPerPallet ?? 1,
    laborPerUnit: chosenPackage ? Number(chosenPackage.laborPerUnit) : 0,
    packaging: (chosenPackage?.lines ?? []).map((line) => ({
      name: line.material.name,
      basis: line.basis,
      qty: Number(line.qty),
      unitCost: Number(line.material.standardCost) > 0 ? Number(line.material.standardCost) : null,
    })),
  });
  const choices = products.filter((item) => item.kind !== "PACKAGING" && item.active).map((item) => ({ id: item.id, name: item.name, sku: item.sku }));
  return (
    <>
      <Flash error={query.error} notice={query.notice} />
      {recipe.id !== product.id ? <p>This package is filled from {recipe.name}. The recipe belongs to that product.</p> : null}
      <FormulaBuilder
        productId={recipe.id}
        productName={recipe.name}
        products={choices.some((item) => item.id === recipe.id) ? choices : [{ id: recipe.id, name: recipe.name, sku: recipe.sku }, ...choices]}
        ingredients={products.filter((item) => item.id !== recipe.id && item.kind !== "PACKAGING").map((item) => ({
          id: item.id,
          name: item.name,
          costPerLb: costOf(item.id),
        }))}
        initial={(current?.lines ?? []).map((line) => ({ ingredientId: line.ingredientId, pounds: String(Number(line.qtyLb) || "") }))}
        gravity={gravity}
        form={form}
        version={current?.version ?? null}
      />
      <details className="advanced">
        <summary>Advanced — packaging, presentations, and earlier versions</summary>
        <div className="row">
          {presets.map((preset) => (
            <Link key={preset.code} className={`choice ${preset.code === selected?.code ? "on" : ""}`} href={`/products/${id}/formula?pack=${preset.code}`}>
              {preset.label}
            </Link>
          ))}
        </div>
        {selected && contentsLb != null ? <p>{selected.label} holds {contentsLb.toLocaleString("en-US", { maximumFractionDigits: 2 })} lb.</p> : <p>Set a specific gravity before a liquid package can be weighed.</p>}
        {cost.ok ? (
          <div className="cards">
            <div className="card"><span>Each</span><strong>{usdPrecise(cost.cost.perUnit)}</strong></div>
            <div className="card"><span>Case</span><strong>{usdPrecise(cost.cost.perCase)}</strong></div>
            <div className="card"><span>Pallet</span><strong>{usdPrecise(cost.cost.perPallet)}</strong></div>
            <div className="card"><span>Per lb</span><strong>{usdPrecise(cost.cost.perLb)}</strong></div>
            {cost.cost.perGal != null && <div className="card"><span>Per gallon</span><strong>{usdPrecise(cost.cost.perGal)}</strong></div>}
          </div>
        ) : <div className="banner bad">{cost.error}</div>}
        {chosenPackage ? (
          <form action={packAction}>
            <input type="hidden" name="packagedSkuId" value={chosenPackage.id} />
            <input type="hidden" name="back" value={`/products?formula=1&id=${id}`} />
            <p>Packing uses {chosenPackage.unitsPerCase} per case and {chosenPackage.casesPerPallet} cases per pallet.</p>
            <div className="grid-2">
              <label className="field">How many<input name="units" defaultValue="1" /></label>
              <label className="field">Date<input type="date" name="packedOn" defaultValue={todayInput()} /></label>
            </div>
            <button className="btn secondary" type="submit">Pack these</button>
          </form>
        ) : null}
        <h2>Earlier versions</h2>
        <ul>
          {recipe.formulas.map((formula) => (
            <li key={formula.id}>Version {formula.version}{formula.isDefault ? " · current" : ""} · {Number(formula.batchQty).toLocaleString("en-US")} lb · {formula.lines.length} ingredients</li>
          ))}
        </ul>
      </details>
    </>
  );
}
