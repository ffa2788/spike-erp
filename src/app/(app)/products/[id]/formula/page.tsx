import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { rollUpCost } from "@/lib/costing";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { usdPrecise } from "@/lib/format";
import { PACKAGE_PRESETS, contentsWeightLb, packagedCost, scaleToPounds } from "@/lib/formula-math";
import { packAction, savePoundsFormula } from "@/server/extra-actions";

export const dynamic = "force-dynamic";

export default async function FormulaBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const pack = typeof (await searchParams).pack === "string" ? String((await searchParams).pack) : "";
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      formulas: { include: { lines: { include: { ingredient: true } } }, orderBy: { version: "desc" } },
      nsfListing: true,
    },
  });
  if (!product) notFound();
  const [products, formulas, packages] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } }),
    prisma.packagedSku.findMany({
      where: { productId: id },
      include: { lines: { include: { material: true } }, outputProduct: true },
    }),
  ]);
  const current = product.formulas.find((formula) => formula.isDefault) ?? product.formulas[0];
  const rolled = rollUpCost(
    product.id,
    products.map((item) => ({ id: item.id, sku: item.sku, name: item.name, kind: item.kind, standardCost: Number(item.standardCost) })),
    formulas.map((formula) => ({
      productId: formula.productId,
      isDefault: formula.isDefault,
      lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
    })),
  );
  const form = product.form === "POWDER" ? "POWDER" : "LIQUID";
  const presets = PACKAGE_PRESETS.filter((preset) => preset.form === form);
  const selected = presets.find((preset) => preset.code === pack) ?? presets[3] ?? presets[0];
  const gravity = current?.specificGravity != null ? Number(current.specificGravity) : product.specificGravity != null ? Number(product.specificGravity) : null;
  const contentsLb = contentsWeightLb({ form, gallons: selected.gallons, netLb: selected.netLb, specificGravity: gravity });
  const scaled = current && contentsLb ? scaleToPounds(current.lines.map((line) => ({ key: line.ingredientId, percent: Number(line.percent) })), contentsLb) : [];
  const chosenPackage = packages.find((item) => item.packageCode === selected.code);
  const cost = packagedCost({
    contentsCostPerLb: rolled.costPerUnit,
    contentsLb: contentsLb ?? 0,
    gallons: selected.gallons,
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
  return (
    <>
      <h1>Formula for {product.name}</h1>
      <p className="lede">Enter the batch in pounds. SPIKE turns that into a 100% formula, then scales it to the package you pick.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className={`banner ${rolled.status === "OK" ? "good" : "bad"}`}>
        {rolled.status === "OK" && rolled.costPerUnit != null
          ? `Recipe cost ${usdPrecise(rolled.costPerUnit)} per lb, including sub-recipes.`
          : rolled.problems[0] ?? "This formula cannot be costed yet."}
      </div>
      <h2>Package</h2>
      <div className="row">
        {presets.map((preset) => (
          <Link key={preset.code} className={`choice ${preset.code === selected.code ? "on" : ""}`} href={`/products/${id}/formula?pack=${preset.code}`}>
            {preset.label}
          </Link>
        ))}
      </div>
      {contentsLb == null ? (
        <p>Set a specific gravity before a liquid package can be weighed.</p>
      ) : (
        <p>{selected.label} holds {contentsLb.toFixed(2)} lb of product{selected.gallons ? ` at specific gravity ${gravity}` : ""}.</p>
      )}
      {current && scaled.length > 0 && (
        <ul>
          {current.lines.map((line) => (
            <li key={line.id}>{line.ingredient.name}: {scaled.find((row) => row.key === line.ingredientId)?.pounds.toFixed(2)} lb ({Number(line.percent).toFixed(2)}%)</li>
          ))}
        </ul>
      )}
      <h2>Cost of this package</h2>
      {cost.ok ? (
        <div className="cards">
          <div className="card"><span>Each</span><strong>{usdPrecise(cost.cost.perUnit)}</strong></div>
          <div className="card"><span>Case</span><strong>{usdPrecise(cost.cost.perCase)}</strong></div>
          <div className="card"><span>Pallet</span><strong>{usdPrecise(cost.cost.perPallet)}</strong></div>
          <div className="card"><span>Per lb</span><strong>{usdPrecise(cost.cost.perLb)}</strong></div>
          <div className="card"><span>Per kg</span><strong>{usdPrecise(cost.cost.perKg)}</strong></div>
          {cost.cost.perGal != null && <div className="card"><span>Per gallon</span><strong>{usdPrecise(cost.cost.perGal)}</strong></div>}
        </div>
      ) : (
        <div className="banner bad">{cost.error}</div>
      )}
      {chosenPackage && (
        <form action={packAction}>
          <input type="hidden" name="packagedSkuId" value={chosenPackage.id} />
          <input type="hidden" name="back" value={`/products/${id}/formula?pack=${selected.code}`} />
          <p>Packing uses {chosenPackage.unitsPerCase} per case and {chosenPackage.casesPerPallet} cases per pallet. Packaging inventory is consumed.</p>
          <div className="grid-2">
            <label className="field">How many<input name="units" defaultValue="1" /></label>
            <label className="field">Date<input type="date" name="packedOn" defaultValue={todayInput()} /></label>
          </div>
          <button className="btn" type="submit">Pack these</button>
        </form>
      )}
      <h2>New version from pounds</h2>
      <form action={savePoundsFormula}>
        <input type="hidden" name="productId" value={product.id} />
        <label className="field">Specific gravity<input name="specificGravity" defaultValue={gravity ?? ""} /></label>
        {[0, 1, 2, 3, 4].map((row) => (
          <div className="grid-2" key={row}>
            <label className="field">Ingredient
              <select name="ingredientId" defaultValue={current?.lines[row]?.ingredientId ?? ""}>
                <option value="">None</option>
                {products.filter((item) => item.id !== product.id && item.kind !== "PACKAGING").map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="field">Pounds<input name="pounds" defaultValue={current?.lines[row] ? String(Number(current.lines[row].qtyLb) || "") : ""} /></label>
          </div>
        ))}
        <label className="field">Note<textarea name="notes" /></label>
        <button className="btn" type="submit">Save this version</button>
      </form>
      <h2>Earlier versions</h2>
      <ul>
        {product.formulas.map((formula) => (
          <li key={formula.id}>Version {formula.version}{formula.isDefault ? " · current" : ""} · {Number(formula.batchQty)} lb · {formula.lines.length} ingredients</li>
        ))}
      </ul>
      <p><Link href={`/products/${product.id}`}>Back to the product</Link></p>
    </>
  );
}
