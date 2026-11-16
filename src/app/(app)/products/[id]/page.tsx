import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { rollUpCost } from "@/lib/costing";
import { prisma } from "@/lib/db";
import { formatDate, usdPrecise } from "@/lib/format";
import { PRODUCT_PATHS, pathShowsFormula, pathSteps } from "@/lib/product-path";
import { defaultFormulaAction, formulaAction, saveProductAction, setProductPathAction, specsAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const product = await prisma.product.findUnique({
    where: { id },
    include: { formulas: { include: { lines: { include: { ingredient: true } } }, orderBy: { version: "desc" } }, specs: true, preferredVendor: true },
  });
  if (!product) notFound();
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  const formulas = await prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } });
  const rolled = rollUpCost(
    product.id,
    products.map((item) => ({ id: item.id, sku: item.sku, name: item.name, kind: item.kind, standardCost: Number(item.standardCost) })),
    formulas.map((formula) => ({
      productId: formula.productId,
      isDefault: true,
      lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
    })),
  );
  const vendors = products && await prisma.party.findMany({ where: { isVendor: true, active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <h1>{product.name}</h1>
      <p className="lede">{product.sku} · {product.unit}</p>
      <Flash error={query.error} notice={query.notice} />
      {product.kind === "FINISHED" && (
        <>
          <h2>How SPER handles this</h2>
          <p>Raw material is purchased, then it is resold, repacked, or manufactured.</p>
          <form action={setProductPathAction} className="row">
            <input type="hidden" name="id" value={product.id} />
            <label className="field">Type
              <select name="path" defaultValue={product.path}>
                {PRODUCT_PATHS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </label>
            <button className="btn secondary" type="submit">Save the type</button>
          </form>
          <ol>
            {pathSteps(product.path).map((step) => <li key={step.title}><strong>{step.title}.</strong> {step.detail}</li>)}
          </ol>
          {product.path !== "RESALE" && <p><Link href={`/products/${product.id}/formula`}>Presentations and packaging cost</Link></p>}
          {pathShowsFormula(product.path) && <p><Link href={`/products/${product.id}/formula`}>Formula</Link></p>}
        </>
      )}
      {product.kind === "FINISHED" && pathShowsFormula(product.path) && (
        <div className={`banner ${rolled.status === "OK" ? "good" : "bad"}`}>
          {rolled.status === "OK" && rolled.costPerUnit != null
            ? `Recipe cost today is ${usdPrecise(rolled.costPerUnit)} per ${product.unit}. This includes sub-recipes.`
            : `Recipe cost cannot be used. ${rolled.problems[0] ?? "Add a complete formula."}`}
        </div>
      )}
      {product.kind === "UTILITY" && <p>This is a utility. Consumption can be recorded, and it does not have an on-hand balance.</p>}
      <dl>
        <dt>Selling price</dt><dd>{product.priceStatus === "CONFIRMED" && product.listPrice != null ? usdPrecise(Number(product.listPrice)) : "Not set — cannot be sold"}</dd>
        <dt>Preferred supplier</dt><dd>{product.preferredVendor?.name ?? "None"} · lead time {product.leadTimeDays ?? "—"} days</dd>
        <dt>Last purchase price</dt><dd>{product.lastPurchasePrice != null ? usdPrecise(Number(product.lastPurchasePrice)) : "—"}</dd>
        <dt>NSF/ANSI 60</dt><dd>{product.nsfCertified ? `${product.nsfCertNumber}, formula version ${product.nsfFormulaVersion}, expires ${formatDate(product.nsfExpiresOn)}` : "No claim"}</dd>
      </dl>
      {rolled.breakdown.length > 0 && (
        <>
          <h2>Default recipe</h2>
          <ul>
            {rolled.breakdown.map((line) => {
              const ingredient = products.find((item) => item.id === line.ingredientId);
              return (
                <li key={line.ingredientId}>
                  {ingredient?.name} · {line.percent}% · {line.contribution == null ? "cost missing" : usdPrecise(line.contribution)}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <h2>Versions</h2>
      {product.formulas.map((formula) => (
        <p key={formula.id}>
          Version {formula.version} {formula.isDefault ? "· default" : ""}
          {product.nsfFormulaVersion === formula.version ? " · certified version" : ""}
          {!formula.isDefault && (
            <form action={defaultFormulaAction} style={{ display: "inline" }}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="formulaId" value={formula.id} />
              <button className="btn secondary" type="submit">Make default</button>
            </form>
          )}
        </p>
      ))}
      {product.kind === "FINISHED" && (
        <details>
          <summary>Save a new formula version</summary>
          <form action={formulaAction}>
            <input type="hidden" name="productId" value={product.id} />
            <label className="field">Batch size<input name="batchQty" defaultValue="1000" required /></label>
            {[0, 1, 2, 3, 4].map((row) => (
              <div className="grid-2" key={row}>
                <label className="field">Ingredient
                  <select name="ingredientId" defaultValue="">
                    <option value="">None</option>
                    {products.filter((item) => item.id !== product.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="field">Percent<input name="percent" /></label>
              </div>
            ))}
            <label className="field"><input type="checkbox" name="makeDefault" value="yes" defaultChecked /> Make this the default</label>
            <button className="btn" type="submit">Save version</button>
          </form>
        </details>
      )}
      <h2>Quality checks</h2>
      <ul>{product.specs.map((spec) => <li key={spec.id}>{spec.parameter}: {spec.min != null ? Number(spec.min) : "—"} to {spec.max != null ? Number(spec.max) : "—"} {spec.unit}</li>)}</ul>
      <details>
        <summary>Change quality checks</summary>
        <form action={specsAction}>
          <input type="hidden" name="productId" value={product.id} />
          {[0, 1, 2].map((row) => (
            <div className="grid-3" key={row}>
              <label className="field">Check<input name="parameter" defaultValue={product.specs[row]?.parameter ?? ""} /></label>
              <label className="field">Low<input name="min" defaultValue={product.specs[row]?.min != null ? String(Number(product.specs[row].min)) : ""} /></label>
              <label className="field">High<input name="max" defaultValue={product.specs[row]?.max != null ? String(Number(product.specs[row].max)) : ""} /></label>
              <input type="hidden" name="unit" value={product.specs[row]?.unit ?? ""} />
            </div>
          ))}
          <button className="btn secondary" type="submit">Save checks</button>
        </form>
      </details>
      <details>
        <summary>Change this product</summary>
        <form action={saveProductAction}>
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="kind" value={product.kind} />
          <label className="field">SKU<input name="sku" defaultValue={product.sku} required /></label>
          <label className="field">Name<input name="name" defaultValue={product.name} required /></label>
          <label className="field">Unit<input name="unit" defaultValue={product.unit} required /></label>
          <label className="field">Standard cost<input name="standardCost" defaultValue={String(Number(product.standardCost))} /></label>
          <label className="field">Selling price<input name="listPrice" defaultValue={product.listPrice != null ? String(Number(product.listPrice)) : ""} /></label>
          <label className="field"><input type="checkbox" name="allowOneDollar" value="yes" defaultChecked={product.allowOneDollar} /> The price really is one dollar</label>
          <label className="field"><input type="checkbox" name="sellable" value="yes" defaultChecked={product.sellable} /> We sell this</label>
          <label className="field"><input type="checkbox" name="taxable" value="yes" defaultChecked={product.taxable} /> Taxable</label>
          <label className="field"><input type="checkbox" name="trackInventory" value="yes" defaultChecked={product.trackInventory} /> Keep an on-hand balance</label>
          <label className="field">Reorder point<input name="minQty" defaultValue={String(Number(product.minQty))} /></label>
          <label className="field">Shelf life in days<input name="shelfLifeDays" defaultValue={product.shelfLifeDays ?? ""} /></label>
          <label className="field">Pack<input name="pack" defaultValue={product.pack} /></label>
          <label className="field">Preferred supplier
            <select name="preferredVendorId" defaultValue={product.preferredVendorId ?? ""}>
              <option value="">None</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </label>
          <label className="field">Lead time days<input name="leadTimeDays" defaultValue={product.leadTimeDays ?? ""} /></label>
          <label className="field"><input type="checkbox" name="nsfCertified" value="yes" defaultChecked={product.nsfCertified} /> NSF/ANSI 60 claim</label>
          <label className="field">Certificate number<input name="nsfCertNumber" defaultValue={product.nsfCertNumber} /></label>
          <label className="field">Certified formula version<input name="nsfFormulaVersion" defaultValue={product.nsfFormulaVersion ?? ""} /></label>
          <label className="field">Certificate expires<input type="date" name="nsfExpiresOn" defaultValue={product.nsfExpiresOn ? product.nsfExpiresOn.toISOString().slice(0, 10) : ""} /></label>
          <label className="field">Claim text<textarea name="nsfClaim" defaultValue={product.nsfClaim} /></label>
          <label className="field">Signal word<input name="ghsSignal" defaultValue={product.ghsSignal} /></label>
          <label className="field">Pictograms<input name="ghsPictograms" defaultValue={product.ghsPictograms} /></label>
          <label className="field">Hazards<textarea name="hazardStatements" defaultValue={product.hazardStatements} /></label>
          <label className="field">Precautions<textarea name="precautionary" defaultValue={product.precautionary} /></label>
          <label className="field">Notes<textarea name="notes" defaultValue={product.notes} /></label>
          <button className="btn" type="submit">Save product</button>
        </form>
      </details>
      <p><Link className="btn" href={`/products/${product.id}/formula`}>Open the formula builder</Link></p>
      <p><Link href="/products">Back to products</Link></p>
    </>
  );
}
