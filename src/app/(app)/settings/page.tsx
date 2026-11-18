import { Flash, readQuery } from "@/components/ui";
import { Screen, one } from "@/components/screen";
import { prisma } from "@/lib/db";
import { saveTrevorEmail } from "@/server/planning-actions";
import { UsersPage } from "./users/view";
import { TaxPage as TaxRatesPage } from "./tax/view";
import { NsfPage } from "./nsf/view";
import { AuditPage } from "./audit/view";
import { GuidePage } from "./guide/view";
import { ImportPage } from "../import/view";
import { ManualTab } from "./manual-tab";
import { HelpRequestsTab } from "./help-tab";
import { createApiKey, revokeApiKey } from "@/server/api-key-actions";
import AccountPage from "../account/page";

export const dynamic = "force-dynamic";

const TABS = [
  ["account", "My account"],
  ["company", "Company"],
  ["users", "Users"],
  ["tax", "Tax rates"],
  ["nsf", "NSF"],
  ["import", "Import"],
  ["integrations", "Integrations"],
  ["audit", "Audit"],
  ["guide", "Guide"],
  ["manual", "Manual"],
  ["help", "Help requests"],
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = await readQuery(Promise.resolve(sp));
  const again = Promise.resolve(sp);
  const tab = TABS.some(([id]) => id === one(sp, "tab")) ? one(sp, "tab") : "company";
  const [company, keys] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { id: "company" } }),
    prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <Screen
      title="Settings"
      lede={`${company?.legalName ?? "SPER"}, ${company?.city ?? ""} ${company?.state ?? ""}. Trevor has no login. His email is stored here.`}
      active={tab}
      tabs={TABS.map(([tabId, label]) => ({ id: tabId, label, href: `/settings?tab=${tabId}` }))}
    >
      {tab === "account" && <AccountPage searchParams={again} />}
      {tab === "company" && (
        <>
          <Flash error={query.error} notice={query.notice} />
          <h2>Trevor's email</h2>
          <p>Release to Trevor sends this address the production plan PDF and a short HTML table.</p>
          <form action={saveTrevorEmail} className="row">
            <label className="field">Email<input name="trevorEmail" type="email" defaultValue={company?.trevorEmail ?? ""} placeholder="trevor@sper.example" /></label>
            <button className="btn" type="submit">Save Trevor's email</button>
          </form>
        </>
      )}
      {tab === "users" && <UsersPage searchParams={again} />}
      {tab === "tax" && <TaxRatesPage searchParams={again} />}
      {tab === "nsf" && <NsfPage searchParams={again} />}
      {tab === "import" && <ImportPage />}
      {tab === "integrations" && (
        <>
          <Flash error={query.error} notice={query.notice} />
          <h2>SPIKE bot key</h2>
          <p>The bot uses this key to post Amazon reports and to read the reconciliation. Copy the key from the notice. It is stored only as a hash.</p>
          <form action={createApiKey}>
            <label className="field">Name<input name="name" defaultValue="SPIKE bot" /></label>
            <input type="hidden" name="read" value="yes" />
            <input type="hidden" name="sales" value="yes" />
            <input type="hidden" name="purchasing" value="yes" />
            <input type="hidden" name="planning" value="yes" />
            <input type="hidden" name="money" value="yes" />
            <button className="btn" type="submit">Create a key</button>
          </form>
          <ul>
            {keys.map((key) => (
              <li key={key.id}>
                {key.name} · {key.prefix}… · {key.revokedAt ? "revoked" : key.scopes}
                {!key.revokedAt && (
                  <form action={revokeApiKey}><input type="hidden" name="id" value={key.id} /><button className="btn secondary" type="submit">Revoke</button></form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "audit" && <AuditPage />}
      {tab === "guide" && <GuidePage />}
      {tab === "manual" && <ManualTab searchParams={again} />}
      {tab === "help" && <HelpRequestsTab searchParams={again} />}
    </Screen>
  );
}
