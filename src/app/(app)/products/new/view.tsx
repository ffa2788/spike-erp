import { Flash, readQuery } from "@/components/ui";
import { saveProductAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  return (
    <>
      <h1>New product</h1>
      <p className="lede">The name and SKU must be new. A second copy of the same product is blocked.</p>
      <Flash error={query.error} />
      <form action={saveProductAction}>
        <label className="field">SKU<input name="sku" required /></label>
        <label className="field">Name<input name="name" required /></label>
        <label className="field">Kind
          <select name="kind" defaultValue="RAW">
            <option value="RAW">Raw material</option>
            <option value="FINISHED">Finished product</option>
            <option value="UTILITY">Utility, not stored</option>
          </select>
        </label>
        <label className="field">Unit<input name="unit" defaultValue="lb" required /></label>
        <label className="field">Standard cost<input name="standardCost" defaultValue="0" /></label>
        <label className="field">Selling price<input name="listPrice" /></label>
        <label className="field"><input type="checkbox" name="sellable" value="yes" /> We sell this</label>
        <label className="field"><input type="checkbox" name="taxable" value="yes" defaultChecked /> Taxable</label>
        <label className="field"><input type="checkbox" name="trackInventory" value="yes" defaultChecked /> Keep an on-hand balance</label>
        <button className="btn" type="submit">Save product</button>
      </form>
    </>
  );
}
