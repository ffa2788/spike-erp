import { Flash, readQuery } from "@/components/ui";
import { CREDIT_TERMS, INCOTERMS } from "@/lib/commercial";
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
          <label className="field">Shipping term
            <select name="incoterm" defaultValue="DAP">{INCOTERMS.map((term) => <option key={term}>{term}</option>)}</select>
          </label>
          <label className="field">Named place<input name="namedPlace" defaultValue="Clearwater plant" required /></label>
          <label className="field">Currency<input name="currency" defaultValue="USD" /></label>
          <label className="field">Payment terms
            <select name="creditTerm" defaultValue="NET_30">{CREDIT_TERMS.map((term) => <option key={term.code} value={term.code}>{term.label}</option>)}</select>
          </label>
          <label className="field">Custom days <span>Only for custom terms</span><input name="customNetDays" defaultValue="30" /></label>
          <label className="field">Early-pay percent <span>2 means 2%</span><input name="earlyPayPercent" defaultValue="2" /></label>
          <label className="field">Early-pay days<input name="earlyPayDays" defaultValue="10" /></label>
          <label className="field">Freight <span>Only if the term says you pay it</span><input name="freight" defaultValue="0" /></label>
          <label className="field">Insurance <span>Only for CIF or CIP</span><input name="insurance" defaultValue="0" /></label>
          <label className="field">Quote discount <span>10% or 25.00</span><input name="docDiscount" /></label>
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
            <label className="field">Special price <span>Blank uses the customer's price</span><input name="specialPrice" inputMode="decimal" /></label>
            <label className="field">Line discount <span>10% or 5.00</span><input name="lineDiscount" /></label>
          </div>
        ))}
        <label className="field">Notes<textarea name="notes" /></label>
        <button className="btn" type="submit">Save the quote</button>
      </form>
    </>
  );
}
