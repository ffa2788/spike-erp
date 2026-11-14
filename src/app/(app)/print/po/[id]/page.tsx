import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PrintPo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: { party: true, lines: { include: { product: true } } } });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  if (!order || !company) notFound();
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print this purchase order" /></p>
      <h1>Purchase order {order.number}</h1>
      <p>{company.legalName}<br />Please deliver to {company.address}, {company.city}, {company.state} {company.zip}</p>
      <p>Supplier {order.party.name}. Date {formatDate(order.orderedOn)}. Expected {formatDate(order.expectedOn)}.</p>
      <table>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}><td>{line.description}</td><td>{formatQty(Number(line.qty), line.product.unit)}</td><td>{usd(line.unitPriceCents)}</td><td>{usd(Math.round(Number(line.qty) * line.unitPriceCents))}</td></tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
