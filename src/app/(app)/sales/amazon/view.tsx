import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { amazonConnection } from "@/lib/amazon-sp";
import { pullAmazonOrders, pullFbaInventory } from "@/server/extra-actions";

export const dynamic = "force-dynamic";

export async function AmazonPage({
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
          The Selling Partner API is turned off. Amazon sales come from the Seller Central reports. {connection.missing.length ? `If it is turned on later, these are still empty: ${connection.missing.join(", ")}.` : ""}
        </div>
      )}
      <p className="lede">
        Reports are the way in. The bot downloads All Orders, the payments date range file, and the settlement flat file, then posts them. The Selling Partner API stays off.
      </p>
      {connection.connected && (
        <div className="row">
          <form action={pullAmazonOrders}><button className="btn" type="submit">Pull orders from the last 14 days</button></form>
          <form action={pullFbaInventory}><button className="btn secondary" type="submit">Read the latest FBA inventory report</button></form>
        </div>
      )}
      <p><Link className="btn" href="/sales/amazon/import">Upload Seller Central reports</Link></p>
      <p><Link href="/import">Use the simple CSV fallback instead</Link></p>
    </>
  );
}
