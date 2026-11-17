import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { usd } from "@/lib/format";
import { amazonWeek } from "@/lib/services/amazon-week";
import { confirmAssembliesAction, matchDepositAction } from "@/server/amazon-week-actions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function AmazonWeekPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const week = await amazonWeek();
  const bank = await prisma.statementLine.findMany({ where: { reconciled: false }, orderBy: { postedOn: "desc" }, take: 12 });
  const openAssemblies = week.assemblies.filter((row) => !row.confirmedAt);
  return (
    <>
      <h1>Amazon week</h1>
      <p className="lede">Chris's week for {week.month}. Upload the reports, confirm the assemblies, and match the Truist deposit. Target is under five minutes.</p>
      <Flash error={query.error} notice={query.notice} />
      <div id="amazon-week" className="cards">
        <div className="card"><span>Orders imported</span><strong>{week.orders}</strong></div>
        <div className="card"><span>Invoices created</span><strong>{week.invoices}</strong><p className="muted">{week.fba} FBA · {week.fbm} FBM · {week.pdfs} PDFs</p></div>
        <div className="card"><span>Assemblies posted</span><strong>{week.assemblies.length}</strong></div>
        <div className="card"><span>Deposits</span><strong>{week.deposits.length}</strong></div>
      </div>
      <p><Link href={`/api/amazon/invoices.zip?period=${week.month}`}>Download the invoice PDFs for {week.month}</Link></p>
      <h2>Assemblies posted</h2>
      {week.assemblies.length === 0 ? <p>No assembly was needed. Finished goods covered the FBM orders.</p> : (
        <div className="wrap"><table>
          <thead><tr><th>SKU</th><th className="num">Units</th><th>Confirmed</th></tr></thead>
          <tbody>
            {week.assemblies.map((row) => (
              <tr key={row.id}><td>{row.sku}</td><td className="num">{row.units}</td><td>{row.confirmedAt ? "Yes" : "Waiting"}</td></tr>
            ))}
          </tbody>
        </table></div>
      )}
      {openAssemblies.length > 0 && (
        <form action={confirmAssembliesAction}><button className="btn" type="submit">Confirm the assemblies</button></form>
      )}
      <h2 id="amazon-deposit">Match the deposit</h2>
      <p>Invoices are cleared at gross. Fees, refunds, storage, ads, labels, and reimbursements are their own lines. The net is the deposit, and it has to match the Truist line to the penny.</p>
      {week.deposits.length === 0 ? <p>No Amazon deposit is posted yet. Import the payments report.</p> : week.deposits.map((deposit) => (
        <form key={deposit.settlementId || deposit.memo} action={matchDepositAction} className="row">
          <input type="hidden" name="settlementId" value={deposit.settlementId} />
          <strong className="num">{usd(deposit.cents)}</strong>
          <span>{deposit.settlementId || deposit.memo}</span>
          <label className="field">Truist line
            <select name="statementLineId">
              <option value="">Choose the bank line</option>
              {bank.map((line) => <option key={line.id} value={line.id}>{usd(line.amountCents)} · {line.description}</option>)}
            </select>
          </label>
          <button className="btn" type="submit">Match deposit</button>
        </form>
      ))}
      <h2>Amazon fees by month</h2>
      <div className="wrap"><table>
        <thead><tr><th>Month</th><th>Account</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {week.fees.map((row) => (
            <tr key={`${row.month}-${row.account}`}><td>{row.month}</td><td>{row.account} {row.name}</td><td className="num">{usd(row.cents)}</td></tr>
          ))}
          {week.fees.length === 0 && <tr><td colSpan={3}>No Amazon fees posted yet.</td></tr>}
        </tbody>
      </table></div>
      <h2>Exceptions to fix</h2>
      {week.unmapped.length === 0 ? <p>No unmapped SKUs.</p> : (
        <ul>{week.unmapped.map((row) => <li key={row.sku}>{row.sku} on {row.amazonOrderId}</li>)}</ul>
      )}
      <p><Link href="/sales?tab=amazon">Upload the Seller Central reports</Link></p>
    </>
  );
}
