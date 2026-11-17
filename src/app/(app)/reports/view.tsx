import Link from "next/link";

export const dynamic = "force-dynamic";

const reports = [
  ["sales", "Sales", "Product sales by customer, product, and channel."],
  ["margins", "Margins", "Sales minus cost, then Amazon fees."],
  ["inventory", "Inventory valuation", "Lot costs, which the books are checked against."],
  ["ar", "Who owes us", "Open invoices by how late they are."],
  ["ap", "Who we owe", "Open supplier bills by how late they are."],
  ["profit", "Profit", "Income, cost, and expenses from the journal."],
  ["balance", "Balance sheet", "What we own equals what we owe plus equity."],
];

export function ReportsPage() {
  return (
    <>
      <h1>Reports</h1>
      <p className="lede">Each report reads the same records as the Today page. Print any of them. The <Link href="/tax">Tax Center</Link> is the year-end package for your CPA.</p>
      <div className="attention">
        {reports.map(([slug, title, detail]) => (
          <Link key={slug} href={`/reports/${slug}`}>
            <article className="card"><strong>{title}</strong><span>{detail}</span></article>
          </Link>
        ))}
      </div>
    </>
  );
}
