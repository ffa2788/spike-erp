import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { createPo } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function NewPoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const [vendors, products] = await Promise.all([
    prisma.party.findMany({ where: { isVendor: true, active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { trackInventory: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <h1>New purchase order</h1>
      <p className="lede">A price of $0 or a bare $1.00 is blocked. Tick the box only when one dollar is the real price.</p>
      <Flash error={query.error} />
      <form action={createPo}>
        <label className="field">Supplier
          <select name="partyId" required>
            <option value="">Choose</option>
            {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
          </select>
        </label>
        <div className="grid-2">
          <label className="field">Order date<input type="date" name="orderedOn" defaultValue={todayInput()} required /></label>
          <label className="field">Expected<input type="date" name="expectedOn" /></label>
        </div>
        {[0, 1, 2].map((row) => (
          <div className="grid-3" key={row}>
            <label className="field">Material
              <select name="productId" defaultValue="">
                <option value="">None</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label className="field">Quantity<input name="qty" /></label>
            <label className="field">Price each<input name="unitPrice" /></label>
          </div>
        ))}
        <label className="field">Notes<textarea name="notes" /></label>
        <input type="hidden" name="send" value="yes" />
        <button className="btn" type="submit">Save and send</button>
      </form>
    </>
  );
}
