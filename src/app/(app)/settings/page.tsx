import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  return (
    <>
      <h1>Settings</h1>
      <p className="lede">{company?.legalName}, {company?.city}, {company?.state}</p>
      <div className="attention">
        <Link href="/settings/guide"><article className="card"><strong>How the work flows</strong><span>Plain steps for quotes, purchasing, batches, and the bank.</span></article></Link>
        <Link href="/settings/users"><article className="card"><strong>People and roles</strong><span>Owner, partner, warehouse, and read only.</span></article></Link>
        <Link href="/settings/audit"><article className="card"><strong>Change history</strong><span>Who changed what.</span></article></Link>
        <Link href="/settings/tax"><article className="card"><strong>Sales tax rates</strong><span>State and local rates, in percent.</span></article></Link>
      </div>
    </>
  );
}
