import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, usd } from "@/lib/format";
import { INVOICE_LABEL, PO_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const [orders, bills] = await Promise.all([
    prisma.purchaseOrder.findMany({ include: { party: true, lines: true }, orderBy: { orderedOn: "desc" } }),
    prisma.vendorBill.findMany({ include: { party: true }, orderBy: { billedOn: "desc" } }),
  ]);
  return (
    <>
      <div className="row"><h1>Purchasing</h1><Link className="btn" href="/purchasing/orders/new">New purchase order</Link></div>
      <p className="lede">Order, then receive into quarantine, then enter the supplier bill, then pay it.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Number</th><th>Supplier</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td><Link href={`/purchasing/orders/${order.id}`}>{order.number}</Link></td>
              <td>{order.party.name}</td>
              <td>{formatDate(order.orderedOn)}</td>
              <td>{usd(order.lines.reduce((sum, line) => sum + Math.round(Number(line.qty) * line.unitPriceCents), 0))}</td>
              <td>{PO_LABEL[order.status]}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Bills</h2>
      <div className="wrap"><table>
        <thead><tr><th>Number</th><th>Supplier</th><th>Due</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody>
          {bills.map((bill) => (
            <tr key={bill.id}>
              <td><Link href={`/purchasing/bills/${bill.id}`}>{bill.number}</Link></td>
              <td>{bill.party.name}</td>
              <td>{formatDate(bill.dueOn)}</td>
              <td>{usd(bill.balanceCents)}</td>
              <td>{INVOICE_LABEL[bill.status]}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
