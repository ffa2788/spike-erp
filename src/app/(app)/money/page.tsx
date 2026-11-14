import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { usd } from "@/lib/format";
import { assessBooks } from "@/lib/read-models";

export const dynamic = "force-dynamic";

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const books = await assessBooks();
  const entries = await prisma.journalEntry.findMany({ orderBy: { date: "desc" }, take: 30, include: { lines: true } });
  return (
    <>
      <div className="row">
        <h1>Money</h1>
        <Link className="btn" href="/money/journal/new">New journal entry</Link>
        <Link className="btn secondary" href="/money/reconcile">Check the bank</Link>
      </div>
      <p className="lede">Every report in the books comes from posted journal lines. Debits must equal credits.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className={`banner ${books.check.ok ? "good" : "bad"}`}>
        {books.check.ok ? "The books agree. Invoices, bills, lots, and the journal are using the same numbers." : books.check.problems[0]}
      </div>
      <h2>Trial balance</h2>
      <div className="wrap"><table>
        <thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
        <tbody>
          {books.trial.rows.map((row) => (
            <tr key={row.accountCode}><td>{row.accountCode} {row.accountName}</td><td>{usd(row.debitCents)}</td><td>{usd(row.creditCents)}</td></tr>
          ))}
          <tr><td>Total</td><td>{usd(books.trial.debitCents)}</td><td>{usd(books.trial.creditCents)}</td></tr>
        </tbody>
      </table></div>
      <h2>Recent entries</h2>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>{entry.number} · {entry.memo} · {usd(entry.lines.reduce((sum, line) => sum + line.debitCents, 0))}</li>
        ))}
      </ul>
    </>
  );
}
