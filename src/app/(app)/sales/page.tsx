import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, usd } from "@/lib/format";
import { INVOICE_LABEL, ORDER_LABEL, QUOTE_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const [quotes, orders, invoices] = await Promise.all([
    prisma.quote.findMany({ include: { party: true }, orderBy: { issuedOn: "desc" } }),
    prisma.salesOrder.findMany({ include: { party: true }, orderBy: { orderedOn: "desc" } }),
    prisma.invoice.findMany({ include: { party: true }, orderBy: { issuedOn: "desc" } }),
  ]);
  return (
    <>
      <div className="row">
        <h1>Sales</h1>
        <Link className="btn" href="/sales/quotes/new">New quote</Link>
      </div>
      <p className="lede">Quote, then order, then delivery, then invoice, then payment.</p>
      <Flash error={query.error} notice={query.notice} />
      <h2>Quotes</h2>
      <div className="wrap"><table>
        <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          {quotes.map((quote) => (
            <tr key={quote.id}>
              <td><Link href={`/sales/quotes/${quote.id}`}>{quote.number} rev {quote.revision}</Link></td>
              <td>{quote.party.name}</td>
              <td>{formatDate(quote.issuedOn)}</td>
              <td>{usd(quote.totalCents)}</td>
              <td>{QUOTE_LABEL[quote.status]}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Orders</h2>
      <div className="wrap"><table>
        <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td><Link href={`/sales/orders/${order.id}`}>{order.number}</Link></td>
              <td>{order.party.name}</td>
              <td>{formatDate(order.orderedOn)}</td>
              <td>{ORDER_LABEL[order.status]}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Invoices</h2>
      <div className="wrap"><table>
        <thead><tr><th>Number</th><th>Customer</th><th>Due</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td><Link href={`/sales/invoices/${invoice.id}`}>{invoice.number}</Link></td>
              <td>{invoice.party.name}</td>
              <td>{formatDate(invoice.dueOn)}</td>
              <td>{usd(invoice.balanceCents)}</td>
              <td>{INVOICE_LABEL[invoice.status]}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
