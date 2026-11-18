import { Flash, readQuery } from "@/components/ui";
import { savePartyAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  return (
    <>
      <h1>New customer</h1>
      <Flash error={query.error} />
      <form action={savePartyAction}>
        <input type="hidden" name="kind" value="customers" />
        <label className="field">ID<input name="code" required /></label>
        <label className="field">Name<input name="name" required /></label>
        <label className="field">Channel
          <select name="channel" defaultValue="DIRECT">
            <option value="DIRECT">Direct</option>
            <option value="DISTRIBUTOR">Distributor</option>
            <option value="MUNICIPAL">Municipal</option>
            <option value="AMAZON">Amazon</option>
            <option value="WALMART">Walmart FBM</option>
            <option value="EXPORT">Export — Caribbean or Mexico</option>
          </select>
        </label>
        <label className="field">Contact<input name="contactName" /></label>
        <label className="field">Email<input name="email" /></label>
        <label className="field">Phone<input name="phone" /></label>
        <label className="field">Street<input name="billStreet" /></label>
        <div className="grid-2">
          <label className="field">City<input name="billCity" /></label>
          <label className="field">State<input name="billState" maxLength={2} /></label>
        </div>
        <label className="field">Ship to state<input name="shipState" maxLength={2} /></label>
        <label className="field">Tax locality, such as Pinellas<input name="taxLocality" /></label>
        <label className="field">Payment terms in days<input name="paymentTermsDays" defaultValue="30" /></label>
        <label className="field">Credit limit<input name="creditLimit" defaultValue="0" /></label>
        <label className="field"><input type="checkbox" name="taxExempt" value="yes" /> Tax exempt</label>
        <label className="field">Certificate number<input name="exemptionNumber" /></label>
        <label className="field">Certificate state<input name="exemptionState" maxLength={2} /></label>
        <label className="field">Certificate expires<input type="date" name="exemptionExpires" /></label>
        <label className="field">Notes<textarea name="notes" /></label>
        <button className="btn" type="submit">Save customer</button>
      </form>
    </>
  );
}
