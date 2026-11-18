import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PrintDelivery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: { order: { include: { party: true } }, lines: { include: { lot: true, orderLine: { include: { product: true } } } } },
  });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  if (!delivery || !company) notFound();
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print this delivery note" /></p>
      <p className="watermark">DELIVERY NOTE — NOT AN INVOICE</p>
      <h1>{delivery.number}</h1>
      <p>{company.legalName}, {company.city}, {company.state}</p>
      <p>To {delivery.order.party.name}<br />{[delivery.order.shipStreet, delivery.order.shipCity, delivery.order.shipState, delivery.order.shipZip].filter(Boolean).join(", ")}</p>
      <p>Date {formatDate(delivery.shippedOn)}. Order {delivery.order.number}. Carrier {delivery.carrier || "—"}. Tracking {delivery.tracking || "—"}.</p>
      <table>
        <thead><tr><th>Product</th><th>Lot</th><th>Quantity</th></tr></thead>
        <tbody>
          {delivery.lines.map((line) => (
            <tr key={line.id}><td>{line.orderLine.description}</td><td>{line.lot.lotNumber}</td><td>{formatQty(Number(line.qty), line.orderLine.product.unit)}</td></tr>
          ))}
        </tbody>
      </table>
      <p>Received by ___________________________ Date _______________</p>
    </article>
  );
}
