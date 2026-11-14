import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PrintOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.salesOrder.findUnique({ where: { id }, include: { party: true, lines: { include: { product: true } } } });
  if (!order) notFound();
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print this order" /></p>
      <h1>Order {order.number}</h1>
      <p>{order.party.name}. Date {formatDate(order.orderedOn)}. Customer PO {order.customerPo || "—"}.</p>
      <p>Ship to {[order.shipStreet, order.shipCity, order.shipState, order.shipZip].filter(Boolean).join(", ")}</p>
      <table>
        <tbody>
          {order.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{formatQty(Number(line.qty), line.product.unit)}</td><td>{usd(line.unitPriceCents)}</td></tr>)}
        </tbody>
      </table>
    </article>
  );
}
