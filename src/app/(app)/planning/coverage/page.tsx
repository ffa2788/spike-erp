import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatQty } from "@/lib/format";
import { emailSetup } from "@/lib/email";
import { dispatchStockAlerts } from "@/lib/services/mrp-run";
import { saveRecipient, sendAlertsNow, setDigest } from "@/server/planning-actions";

export const dynamic = "force-dynamic";

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const setup = emailSetup();
  const result = await dispatchStockAlerts();
  const status = query.from || "ALL";
  const kind = query.to || "ALL";
  const rows = result.coverage
    .filter((row) => row.product.kind === "FINISHED" || row.product.kind === "RAW" || row.product.kind === "PACKAGING")
    .filter((row) => status === "ALL" || row.status === status)
    .filter((row) => kind === "ALL" || row.product.kind === kind)
    .sort((a, b) => (a.daysVsUsage ?? 9999) - (b.daysVsUsage ?? 9999));
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  const recipients = await prisma.alertRecipient.findMany({ orderBy: { email: "asc" } });
  const logs = await prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 });
  return (
    <>
      <h1>Coverage</h1>
      <p className="lede">Released stock only. Days of cover use the average of the last 12 weeks of sales. The week columns compare that stock with materials-plan demand.</p>
      <Flash error={query.error} notice={query.notice} />
      {setup.configured ? (
        <div className="banner good">Email is configured from {setup.from} through {setup.provider}.</div>
      ) : (
        <div className="banner warn">Email is not configured. Add {setup.missing.join(", ")} and restart. Nothing will be sent.</div>
      )}
      <form className="row">
        <label className="field">Status
          <select name="from" defaultValue={status}>
            <option value="ALL">All</option>
            <option value="CRITICAL">Critical</option>
            <option value="LOW">Low</option>
            <option value="OK">OK</option>
          </select>
        </label>
        <label className="field">Kind
          <select name="to" defaultValue={kind}>
            <option value="ALL">All</option>
            <option value="FINISHED">Finished goods</option>
            <option value="RAW">Raw materials</option>
            <option value="PACKAGING">Packaging</option>
          </select>
        </label>
        <button className="btn secondary" type="submit">Filter</button>
        <Link href="/planning">Back to the plan</Link>
      </form>
      <div className="wrap"><table>
        <thead>
          <tr>
            <th>Item</th><th>On hand</th><th>Days vs usage</th>
            <th>1 wk</th><th>2 wk</th><th>4 wk</th><th>8 wk</th><th>12 wk</th>
            <th>Status</th><th>Open PO</th><th>What to do</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.item.id}>
              <td><Link href={`/products/${row.product.id}`}>{row.product.sku}</Link> {row.item.name}</td>
              <td>{formatQty(row.item.onHandReleased, row.item.unit)}{row.item.onHandQuarantine > 0 ? ` (${formatQty(row.item.onHandQuarantine, row.item.unit)} in quarantine)` : ""}</td>
              <td>{row.daysVsUsage == null ? "—" : row.daysVsUsage}</td>
              <td>{row.weeksVsDemand[1] ?? "—"}</td>
              <td>{row.weeksVsDemand[2] ?? "—"}</td>
              <td>{row.weeksVsDemand[4] ?? "—"}</td>
              <td>{row.weeksVsDemand[8] ?? "—"}</td>
              <td>{row.weeksVsDemand[12] ?? "—"}</td>
              <td>{row.status === "CRITICAL" ? "Critical" : row.status === "LOW" ? "Low" : "OK"}</td>
              <td>{row.openPoQty > 0 ? "Yes" : "No"}</td>
              <td>{row.action}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Who gets a low-stock email</h2>
      <p>The seeded address is marlon@novachem.hn. A product or category recipient overrides that default for those items. One email is sent when an item becomes Low or Critical, not again until the status changes. A daily digest sends one note per day instead.</p>
      <form action={setDigest}>
        <label className="field"><input type="checkbox" name="digest" value="yes" defaultChecked={company?.emailDigest} /> Send a daily digest instead of one email per item</label>
        <button className="btn secondary" type="submit">Save</button>
      </form>
      <form action={saveRecipient}>
        <div className="grid-2">
          <label className="field">Email<input name="email" required /></label>
          <label className="field">Category <span>Blank means every item, unless you pick a product</span><input name="category" /></label>
          <label className="field">Product
            <select name="productId"><option value="">Any</option>{result.coverage.map((row) => <option key={row.item.id} value={row.item.id}>{row.product.name}</option>)}</select>
          </label>
        </div>
        <button className="btn" type="submit">Add recipient</button>
      </form>
      <ul>{recipients.map((row) => <li key={row.id}>{row.email}{row.category ? ` · ${row.category}` : ""}{row.productId ? " · one product" : ""}</li>)}</ul>
      <form action={sendAlertsNow}><button className="btn" type="submit">Send stock alerts now</button></form>
      <h2>Email log</h2>
      <ul>
        {logs.map((row) => <li key={row.id}>{row.status}: {row.toAddress} — {row.subject}</li>)}
        {logs.length === 0 && <li>No emails have been sent.</li>}
      </ul>
    </>
  );
}
