import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { DrawerClose, Screen, one } from "@/components/screen";
import { prisma } from "@/lib/db";
import { usd } from "@/lib/format";
import { assessBooks } from "@/lib/read-models";
import { ReconcilePage } from "./reconcile/view";
import { NewJournalPage } from "./journal/new/view";
import { PayrollPage } from "../payroll/view";
import { PayRunPage } from "../payroll/runs/[id]/view";
import { TaxCenterPage } from "../tax/view";
import { ReportsPage } from "../reports/view";
import { ReportPage } from "../reports/[slug]/view";

export const dynamic = "force-dynamic";

const TABS = [
  ["books", "Books"],
  ["bank", "Bank"],
  ["payroll", "Payroll"],
  ["tax", "Tax center"],
  ["reports", "Reports"],
] as const;

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = await readQuery(Promise.resolve(sp));
  const again = Promise.resolve(sp);
  const tab = TABS.some(([id]) => id === one(sp, "tab")) ? one(sp, "tab") : "books";
  const id = one(sp, "id");
  const isNew = one(sp, "new") === "1";
  const books = await assessBooks();
  const entries = await prisma.journalEntry.findMany({ orderBy: { date: "desc" }, take: 30, include: { lines: true } });
  const primary = tab === "books" ? { href: "/money?tab=books&new=1", label: "New journal entry" } : undefined;
  const drawer = tab === "books" && isNew
    ? <NewJournalPage searchParams={again} />
    : tab === "payroll" && id
      ? <PayRunPage params={Promise.resolve({ id })} searchParams={again} />
      : tab === "reports" && id
        ? <ReportPage params={Promise.resolve({ slug: id })} searchParams={again} />
        : null;
  return (
    <Screen
      title="Money"
      lede="Bank, payroll, tax, and the books. Every report comes from posted journal lines."
      primary={primary}
      active={tab}
      tabs={TABS.map(([tabId, label]) => ({ id: tabId, label, href: `/money?tab=${tabId}` }))}
      drawer={drawer ? <><DrawerClose href={`/money?tab=${tab}`} />{drawer}</> : undefined}
    >
      {tab === "books" && (
        <>
          <Flash error={query.error} notice={query.notice} />
          <div className={`banner ${books.check.ok ? "good" : "bad"}`}>
            {books.check.ok ? "The books agree. Invoices, bills, lots, and the journal are using the same numbers." : books.check.problems[0]}
          </div>
          <h2>Trial balance</h2>
          <div className="wrap"><table>
            <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {books.trial.rows.map((row) => (
                <tr key={row.accountCode}><td>{row.accountCode} {row.accountName}</td><td className="num">{usd(row.debitCents)}</td><td className="num">{usd(row.creditCents)}</td></tr>
              ))}
              <tr><td>Total</td><td className="num">{usd(books.trial.debitCents)}</td><td className="num">{usd(books.trial.creditCents)}</td></tr>
            </tbody>
          </table></div>
          <h2>Recent entries</h2>
          <div className="wrap"><table>
            <thead><tr><th>Entry</th><th>Memo</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.number}</td>
                  <td>{entry.memo}</td>
                  <td className="num">{usd(entry.lines.reduce((sum, line) => sum + line.debitCents, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
      {tab === "bank" && <ReconcilePage searchParams={again} />}
      {tab === "payroll" && <PayrollPage searchParams={again} />}
      {tab === "tax" && <TaxCenterPage searchParams={again} />}
      {tab === "reports" && !id && <ReportsPage />}
      {tab === "reports" && id ? null : null}
    </Screen>
  );
}
