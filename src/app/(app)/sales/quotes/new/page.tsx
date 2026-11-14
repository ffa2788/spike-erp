import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { createQuote } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const [customers, products] = await Promise.all([
    prisma.party.findMany({ where: { isCustomer: true, active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { sellable: true, active: true, priceStatus: "CONFIRMED" }, orderBy: { name: "asc" } }),
  ]);
  const today = todayInput();
  return (
    <>
      <h1>New quote</h1>
      <p className="lede">Prices come from the product. A blank or $1.00 price cannot be quoted.</p>
      <Flash error={query.error} />
      <form action={createQuote}>
        <label className="field">Customer
          <select name="partyId" required>
            <option value="">Choose</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </label>
        <div className="grid-2">
          <label className="field">Date<input type="date" name="issuedOn" defaultValue={today} required /></label>
          <label className="field">Good until<input type="date" name="validUntil" required /></label>
        </div>
        {[0, 1, 2, 3].map((row) => (
          <div className="grid-3" key={row}>
            <label className="field">Product
              <select name="productId" defaultValue="">
                <option value="">None</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name} — ${Number(product.listPrice).toFixed(2)}</option>
                ))}
              </select>
            </label>
            <label className="field">Quantity<input name="qty" inputMode="decimal" /></label>
            <label className="field">Special price <span>Leave blank to use the list price</span><input name="specialPrice" inputMode="decimal" /></label>
          </div>
        ))}
        <label className="field">Notes<textarea name="notes" /></label>
        <button className="btn" type="submit">Save the quote</button>
      </form>
    </>
  );
}
