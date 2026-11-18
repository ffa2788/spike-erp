import Link from "next/link";

export const dynamic = "force-dynamic";

const reports = [
  ["sales", "Sales", "This period against the prior period, by channel."],
  ["products", "Sales by product", "Units, revenue, cost, and margin."],
  ["customers", "Sales by customer", "Revenue, margin, invoices, and what is still open."],
  ["mrp", "What to buy", "Usage, weeks left, and a suggested purchase."],
  ["profit", "Profit", "Revenue, cost, expenses, and net income."],
  ["balance", "Balance sheet", "What we own equals what we owe plus equity."],
  ["ar", "Who owes us", "Open invoices by how late they are."],
  ["margins", "Margins", "Sales minus cost, then Amazon fees."],
  ["inventory", "Inventory valuation", "Lot costs, which the books are checked against."],
  ["ap", "Who we owe", "Open supplier bills by how late they are."],
];

export function ReportsPage() {
  return (
    <>
      <h1>Reports</h1>
      <p className="lede">Each report reads the same records as the Today page. Print any of them. The <Link href="/tax">Tax Center</Link> is the year-end package for your CPA.</p>
      <div className="report-grid">
        {reports.map(([slug, title, detail]) => (
          <Link key={slug} href={slug === "margins" || slug === "inventory" || slug === "ap" ? `/reports/${slug}` : `/money?tab=reports&id=${slug}&period=month&anchor=2026-10-15`}>
            <article className="card"><strong>{title}</strong><span>{detail}</span></article>
          </Link>
        ))}
      </div>
    </>
  );
}
