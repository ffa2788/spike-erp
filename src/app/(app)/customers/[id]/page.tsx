import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, usd } from "@/lib/format";
import { savePartyAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party?.isCustomer) notFound();
  const open = await prisma.invoice.aggregate({
    where: { partyId: id, status: { in: ["OPEN", "PARTIAL"] } },
    _sum: { balanceCents: true },
  });
  return (
    <>
      <h1>{party.name}</h1>
      <p className="lede">{party.code} · owes {usd(open._sum.balanceCents ?? 0)}</p>
      <Flash error={query.error} notice={query.notice} />
      <dl>
        <dt>Tax</dt><dd>{party.taxExempt ? `Exempt ${party.exemptionNumber}, expires ${formatDate(party.exemptionExpires)}` : `Taxable · ${party.taxLocality || "state only"}`}</dd>
        <dt>Terms</dt><dd>{party.paymentTermsDays} days · credit limit {usd(party.creditLimitCents)}</dd>
        <dt>Ship to</dt><dd>{[party.shipStreet, party.shipCity, party.shipState, party.shipZip].filter(Boolean).join(", ") || "Same as billing"}</dd>
      </dl>
      <details open>
        <summary>Change this customer</summary>
        <form action={savePartyAction}>
          <input type="hidden" name="kind" value="customers" />
          <input type="hidden" name="id" value={party.id} />
          <label className="field">ID<input name="code" defaultValue={party.code} required /></label>
          <label className="field">Name<input name="name" defaultValue={party.name} required /></label>
          <label className="field">Channel
            <select name="channel" defaultValue={party.channel}>
              <option value="DIRECT">Direct</option>
              <option value="DISTRIBUTOR">Distributor</option>
              <option value="MUNICIPAL">Municipal</option>
              <option value="AMAZON">Amazon</option>
              <option value="WALMART">Walmart FBM</option>
              <option value="EXPORT">Export — Caribbean or Mexico</option>
            </select>
          </label>
          <label className="field">Email<input name="email" defaultValue={party.email} /></label>
          <label className="field">Phone<input name="phone" defaultValue={party.phone} /></label>
          <label className="field">Billing street<input name="billStreet" defaultValue={party.billStreet} /></label>
          <label className="field">Billing city<input name="billCity" defaultValue={party.billCity} /></label>
          <label className="field">Billing state<input name="billState" defaultValue={party.billState} /></label>
          <label className="field">Ship street<input name="shipStreet" defaultValue={party.shipStreet} /></label>
          <label className="field">Ship city<input name="shipCity" defaultValue={party.shipCity} /></label>
          <label className="field">Ship state<input name="shipState" defaultValue={party.shipState} /></label>
          <label className="field">Tax locality<input name="taxLocality" defaultValue={party.taxLocality} /></label>
          <label className="field">Terms<input name="paymentTermsDays" defaultValue={String(party.paymentTermsDays)} /></label>
          <label className="field">Credit limit<input name="creditLimit" defaultValue={(party.creditLimitCents / 100).toFixed(2)} /></label>
          <label className="field"><input type="checkbox" name="taxExempt" value="yes" defaultChecked={party.taxExempt} /> Tax exempt</label>
          <label className="field">Certificate<input name="exemptionNumber" defaultValue={party.exemptionNumber} /></label>
          <label className="field">Certificate state<input name="exemptionState" defaultValue={party.exemptionState} /></label>
          <label className="field">Expires<input type="date" name="exemptionExpires" defaultValue={party.exemptionExpires ? party.exemptionExpires.toISOString().slice(0, 10) : ""} /></label>
          <label className="field">Notes<textarea name="notes" defaultValue={party.notes} /></label>
          <label className="field"><input type="checkbox" name="isVendor" value="yes" defaultChecked={party.isVendor} /> Also a supplier</label>
          <button className="btn" type="submit">Save</button>
        </form>
      </details>
    </>
  );
}
