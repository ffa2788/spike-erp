import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { AMAZON_ENV_KEYS, amazonConnection } from "@/lib/amazon-sp";
import { pullAmazonOrders, pullFbaInventory } from "@/server/extra-actions";

export const dynamic = "force-dynamic";

export default async function AmazonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const connection = amazonConnection();
  return (
    <>
      <h1>Amazon</h1>
      <Flash error={query.error} notice={query.notice} />
      {connection.connected ? (
        <div className="banner good">Connected. SPIKE can ask Amazon for orders, FBA inventory, and settlement reports. Nothing is posted until you use the buttons.</div>
      ) : (
        <div className="banner warn">
          Not connected. Add these environment variables, then restart the app: {connection.missing.join(", ")}.
          The CSV import still works.
        </div>
      )}
      <p className="lede">
        Register a private Selling Partner API app in Seller Central, authorize it for this seller, and put the Login with Amazon client id, client secret, and refresh token in the environment.
        Also set the seller id, the marketplace id (the US marketplace is ATVPDKIKX0DER), and the AWS access key and secret used to sign requests.
        SPIKE never stores those values in the database and will not show them here.
      </p>
      <p>Roles to request: Inventory and Order Tracking, Amazon Fulfillment, and Finance and Accounting.</p>
      <ul>
        {AMAZON_ENV_KEYS.map((key) => <li key={key}>{key}: {process.env[key]?.trim() ? "set" : "missing"}</li>)}
      </ul>
      {connection.connected && (
        <div className="row">
          <form action={pullAmazonOrders}><button className="btn" type="submit">Pull orders from the last 14 days</button></form>
          <form action={pullFbaInventory}><button className="btn secondary" type="submit">Read the latest FBA inventory report</button></form>
        </div>
      )}
      <p><Link href="/import">Use the CSV fallback instead</Link></p>
    </>
  );
}
