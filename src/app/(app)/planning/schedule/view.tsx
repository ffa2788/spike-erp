import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { amazonConnection } from "@/lib/amazon-sp";
import { prisma } from "@/lib/db";
import { buildSchedule } from "@/lib/services/schedule-run";
import { formatQty } from "@/lib/format";
import { releaseToTrevor, saveFbaStock } from "@/server/planning-actions";

export const dynamic = "force-dynamic";

const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const weeks = Math.min(52, Math.max(1, Number(query.q) || 8));
  const [schedule, amazon, fbaFile] = await Promise.all([
    buildSchedule(undefined, weeks),
    Promise.resolve(amazonConnection()),
    prisma.fbaBalance.count({ where: { source: "AMAZON_FILE" } }),
  ]);
  return (
    <>
      <h1>Suggested production schedule</h1>
      <p className="lede">
        For Trevor. Each finished package uses the last {weeks} weeks of sales on S, A, and W, plus open orders.
        The target is 14 days of finished inventory unless that SKU uses a different cover.
        Make quantity is what the supermarket, Amazon FBA, and work in process do not already cover, rounded up to the case or batch.
        A shipment to FBA is listed separately and is not a new batch.
      </p>
      <Flash error={query.error} notice={query.notice} />
      {amazon.connected ? (
        <div className="banner good">Amazon is connected. Paste the latest FBA inventory report below, or type the quantities.</div>
      ) : fbaFile > 0 ? (
        <div className="banner good">Amazon's API is not connected. The FBA columns use the Seller Central inventory file you imported.</div>
      ) : (
        <div className="banner warn">Amazon is not connected. Enter FBA fulfillable and inbound quantities here, or paste a CSV. Nothing is invented.</div>
      )}
      <p><Link href="/planning">Back to planning</Link></p>
      <form className="row">
        <label className="field">History window, weeks<input name="q" defaultValue={String(weeks)} /></label>
        <button className="btn secondary" type="submit">Update</button>
      </form>
      <form action={releaseToTrevor}>
        <input type="hidden" name="weeks" value={weeks} />
        <div className="wrap"><table>
          <thead>
            <tr>
              <th>SKU</th><th>Package</th><th>Days of cover</th><th>Daily sales</th><th>Open orders</th>
              <th>Supermarket</th><th>FBA on hand</th><th>In process</th><th>Make</th><th>Ship to FBA</th><th>Day</th><th>Materials</th>
            </tr>
          </thead>
          <tbody>
            {schedule.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.sku}<br />{row.name}</td>
                <td>{row.packageLabel}</td>
                <td>{row.daysCover == null ? "No recent sales" : row.daysCover}</td>
                <td>{formatQty(row.daily, row.unit)}</td>
                <td>{formatQty(row.openOrders, row.unit)}</td>
                <td>{formatQty(row.supermarket, row.unit)}</td>
                <td>{formatQty(row.fbaOnHand, row.unit)}<br />{row.fbaNote}</td>
                <td>{formatQty(row.wip, row.unit)}</td>
                <td><input name={`qty-${row.id}`} defaultValue={String(row.suggested)} /></td>
                <td><input name={`fba-${row.id}`} defaultValue={String(row.fbaReplenish)} /></td>
                <td>
                  <input type="date" name={`day-${row.id}`} defaultValue={row.dueOn} />
                  {row.dueOn ? <div>{dayName[new Date(`${row.dueOn}T00:00:00Z`).getUTCDay()]}</div> : null}
                </td>
                <td>{row.shortage ? "Short. " : ""}{row.materials.map((material) => `${material.name} ${material.qty} ${material.unit}${material.short ? ` short ${material.short}` : ""}`).join("; ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p>Release emails Trevor the printable PDF and a short table. His address is stored in Settings.</p>
        <button className="btn" type="submit">Release to Trevor</button>
      </form>
      <h2>FBA quantities</h2>
      <form action={saveFbaStock}>
        <label className="field">Paste sku, fulfillable, inbound
          <textarea name="csv" placeholder={"sku,fulfillable,inbound\nPOLY-LIQ-1G,6,4"} />
        </label>
        <button className="btn secondary" type="submit">Save FBA quantities</button>
      </form>
    </>
  );
}
