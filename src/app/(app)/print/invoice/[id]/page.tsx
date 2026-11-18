import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PrintInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, company] = await Promise.all([
    prisma.invoice.findUnique({ where: { id }, include: { party: true, lines: true } }),
    prisma.companyProfile.findUnique({ where: { id: "company" } }),
  ]);
  if (!invoice || !company) notFound();
  const tax = Array.isArray(invoice.taxJson) ? invoice.taxJson as { name: string; taxCents: number }[] : [];
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print this invoice" /></p>
      {invoice.isExample && <p className="watermark">EXAMPLE DATA</p>}
      <h1>Invoice {invoice.number}</h1>
      <p>{company.legalName}<br />{company.address}<br />{company.city}, {company.state} {company.zip}<br />{company.phone}</p>
      <p>Bill to {invoice.party.name}<br />{invoice.party.billStreet}<br />{invoice.party.billCity}, {invoice.party.billState} {invoice.party.billZip}</p>
      <p>Date {formatDate(invoice.issuedOn)}. Due {formatDate(invoice.dueOn)}.</p>
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}><td>{line.description}</td><td>{formatQty(Number(line.qty))}</td><td>{usd(line.unitPriceCents)}</td><td>{usd(Math.round(Number(line.qty) * line.unitPriceCents))}</td></tr>
          ))}
        </tbody>
      </table>
      <p>Sales {usd(invoice.subtotalCents)}</p>
      {tax.map((row) => <p key={row.name}>{row.name} {usd(row.taxCents)}</p>)}
      {invoice.exemptionApplied && <p>Exemption {invoice.exemptionNumber} applied. No sales tax.</p>}
      <p><strong>Total {usd(invoice.totalCents)}. Still open {usd(invoice.balanceCents)}.</strong></p>
      <p>Please pay within {invoice.party.paymentTermsDays} days.</p>
    </article>
  );
}
