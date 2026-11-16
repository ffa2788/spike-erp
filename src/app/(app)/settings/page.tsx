import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { saveTrevorEmail } from "@/server/planning-actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  return (
    <>
      <h1>Settings</h1>
      <p className="lede">{company?.legalName}, {company?.city}, {company?.state}</p>
      <Flash error={query.error} notice={query.notice} />
      <h2>Trevor's email</h2>
      <p>Trevor has no login. Release to Trevor sends this address a PDF of the work list and a short table in the message.</p>
      <form action={saveTrevorEmail} className="row">
        <label className="field">Email<input name="trevorEmail" type="email" defaultValue={company?.trevorEmail ?? ""} placeholder="trevor@sper.example" /></label>
        <button className="btn" type="submit">Save Trevor's email</button>
      </form>
      <div className="attention">
        <Link href="/settings/guide"><article className="card"><strong>How the work flows</strong><span>Plain steps for quotes, purchasing, batches, and the bank.</span></article></Link>
        <Link href="/settings/users"><article className="card"><strong>People and roles</strong><span>FFA and Chris. Both see everything.</span></article></Link>
        <Link href="/settings/audit"><article className="card"><strong>Change history</strong><span>Who changed what.</span></article></Link>
        <Link href="/settings/tax"><article className="card"><strong>Sales tax rates</strong><span>State and local rates, in percent.</span></article></Link>
      </div>
    </>
  );
}
