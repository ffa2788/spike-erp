import { Flash, readQuery } from "@/components/ui";
import { savePartyAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function NewVendorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  return (
    <>
      <h1>New supplier</h1>
      <Flash error={query.error} />
      <form action={savePartyAction}>
        <input type="hidden" name="kind" value="vendors" />
        <input type="hidden" name="channel" value="DIRECT" />
        <label className="field">ID<input name="code" required /></label>
        <label className="field">Name<input name="name" required /></label>
        <label className="field">Email<input name="email" /></label>
        <label className="field">Phone<input name="phone" /></label>
        <label className="field">City<input name="billCity" /></label>
        <label className="field">State<input name="billState" maxLength={2} /></label>
        <label className="field">Payment terms<input name="paymentTermsDays" defaultValue="30" /></label>
        <label className="field">Lead time days<input name="leadTimeDays" /></label>
        <label className="field">Notes<textarea name="notes" /></label>
        <button className="btn" type="submit">Save supplier</button>
      </form>
    </>
  );
}
