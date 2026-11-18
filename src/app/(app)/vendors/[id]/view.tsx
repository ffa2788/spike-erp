import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { usd } from "@/lib/format";
import { savePartyAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party?.isVendor) notFound();
  const open = await prisma.vendorBill.aggregate({ where: { partyId: id, status: { in: ["OPEN", "PARTIAL"] } }, _sum: { balanceCents: true } });
  return (
    <>
      <h1>{party.name}</h1>
      <p className="lede">{party.code} · we owe {usd(open._sum.balanceCents ?? 0)}</p>
      <Flash error={query.error} notice={query.notice} />
      <form action={savePartyAction}>
        <input type="hidden" name="kind" value="vendors" />
        <input type="hidden" name="id" value={party.id} />
        <input type="hidden" name="channel" value={party.channel} />
        <label className="field">ID<input name="code" defaultValue={party.code} required /></label>
        <label className="field">Name<input name="name" defaultValue={party.name} required /></label>
        <label className="field">Email<input name="email" defaultValue={party.email} /></label>
        <label className="field">Phone<input name="phone" defaultValue={party.phone} /></label>
        <label className="field">City<input name="billCity" defaultValue={party.billCity} /></label>
        <label className="field">State<input name="billState" defaultValue={party.billState} /></label>
        <label className="field">Terms<input name="paymentTermsDays" defaultValue={String(party.paymentTermsDays)} /></label>
        <label className="field">Lead time<input name="leadTimeDays" defaultValue={party.leadTimeDays ?? ""} /></label>
        <label className="field">Form W-9
          <select name="w9OnFile" defaultValue={party.w9OnFile ? "yes" : "no"}>
            <option value="no">Not on file</option>
            <option value="yes">On file</option>
          </select>
        </label>
        <label className="field">W-9 date<input type="date" name="w9ReceivedOn" defaultValue={party.w9ReceivedOn ? party.w9ReceivedOn.toISOString().slice(0, 10) : ""} /></label>
        <label className="field">1099
          <select name="infoReturn" defaultValue={party.infoReturn}>
            <option value="NONE">No 1099 — goods or a corporation</option>
            <option value="NEC">1099-NEC — services</option>
            <option value="MISC">1099-MISC — rent and other</option>
          </select>
        </label>
        <label className="field">Notes<textarea name="notes" defaultValue={party.notes} /></label>
        <label className="field"><input type="checkbox" name="isCustomer" value="yes" defaultChecked={party.isCustomer} /> Also a customer</label>
        <button className="btn" type="submit">Save</button>
      </form>
    </>
  );
}
