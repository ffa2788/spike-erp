import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { WALMART_ENV_KEYS, walmartConnection } from "@/lib/walmart";

export const dynamic = "force-dynamic";

export async function WalmartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const connection = walmartConnection();
  return (
    <>
      <h1>Walmart</h1>
      <Flash error={query.error} notice={query.notice} />
      {connection.connected ? (
        <div className="banner good">Connected. SPIKE can ask Walmart for orders. Nothing is posted until you import them.</div>
      ) : (
        <div className="banner warn">Not connected. Add {connection.missing.join(" and ")}, then restart the app. The CSV import still works.</div>
      )}
      <p className="lede">
        In Walmart Seller Center, open the API keys for your Marketplace app and copy the client id and client secret.
        SPIKE uses those to request an access token from marketplace.walmartapis.com. It does not store the secret in the database and it does not invent orders.
      </p>
      <ul>
        {WALMART_ENV_KEYS.map((key) => <li key={key}>{key}: {process.env[key]?.trim() ? "set" : "missing"}</li>)}
      </ul>
      <p>Orders that post become W- invoices and keep Walmart's purchase order id next to that number. Fees from a settlement file post to marketplace fees.</p>
      <p><Link href="/import">Use the CSV fallback instead</Link></p>
    </>
  );
}
