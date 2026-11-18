import Link from "next/link";
import { prisma } from "@/lib/db";
import { readQuery } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const q = query.q.trim();
  if (!q) {
    return (
      <>
        <h1>Search</h1>
        <p>Type an invoice number such as S-000001, a quote such as Q-0001, or a marketplace order id.</p>
      </>
    );
  }
  const [invoices, orders, deliveries, payments, quotes] = await Promise.all([
    prisma.invoice.findMany({
      where: { OR: [{ number: { equals: q, mode: "insensitive" } }, { marketplaceOrderId: { equals: q, mode: "insensitive" } }] },
      include: { party: true },
      take: 20,
    }),
    prisma.salesOrder.findMany({ where: { OR: [{ number: { equals: q, mode: "insensitive" } }, { customerPo: { equals: q, mode: "insensitive" } }] }, include: { invoices: true, party: true }, take: 20 }),
    prisma.delivery.findMany({ where: { number: { equals: q, mode: "insensitive" } }, include: { invoice: true, order: true }, take: 20 }),
    prisma.customerPayment.findMany({
      where: { OR: [{ number: { equals: q, mode: "insensitive" } }, { applications: { some: { invoice: { number: { equals: q, mode: "insensitive" } } } } }] },
      include: { applications: { include: { invoice: true } } },
      take: 20,
    }),
    prisma.quote.findMany({ where: { number: { equals: q, mode: "insensitive" } }, take: 20 }),
  ]);
  const empty = invoices.length + orders.length + deliveries.length + payments.length + quotes.length === 0;
  return (
    <>
      <h1>Search</h1>
      <p className="lede">Results for {q}.</p>
      {empty && <p>Nothing matched. Invoice numbers look like S-000001, A-000001, or W-000001.</p>}
      {invoices.map((invoice) => (
        <p key={invoice.id}><Link href={`/sales/invoices/${invoice.id}`}>{invoice.number}</Link> · {invoice.party.name}{invoice.marketplaceOrderId ? ` · marketplace ${invoice.marketplaceOrderId}` : ""}</p>
      ))}
      {orders.map((order) => (
        <p key={order.id}><Link href={`/sales/orders/${order.id}`}>{order.number}</Link> · {order.party.name} · invoices {order.invoices.map((invoice) => invoice.number).join(", ") || "none yet"}</p>
      ))}
      {deliveries.map((delivery) => (
        <p key={delivery.id}><Link href={`/sales/deliveries/${delivery.id}`}>{delivery.number}</Link> · order {delivery.order.number} · invoice {delivery.invoice?.number ?? "not invoiced"}</p>
      ))}
      {payments.map((payment) => (
        <p key={payment.id}>{payment.number} · {payment.applications.map((row) => <Link key={row.id} href={`/sales/invoices/${row.invoiceId}`}>{row.invoice.number}</Link>)}</p>
      ))}
      {quotes.map((quote) => (
        <p key={quote.id}><Link href={`/sales/quotes/${quote.id}`}>{quote.number} rev {quote.revision}</Link></p>
      ))}
    </>
  );
}
