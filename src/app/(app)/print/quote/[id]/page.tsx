import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PrintQuote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await prisma.quote.findUnique({ where: { id }, include: { party: true, lines: { include: { product: true } } } });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  if (!quote || !company) notFound();
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print this quote" /></p>
      <h1>Quote {quote.number}</h1>
      <p>{company.legalName}, {company.city}, {company.state}</p>
      <p>For {quote.party.name}. Good until {formatDate(quote.validUntil)}.</p>
      <table>
        <tbody>
          {quote.lines.map((line) => (
            <tr key={line.id}><td>{line.description}</td><td>{formatQty(Number(line.qty), line.product.unit)}</td><td>{usd(Math.round(Number(line.qty) * line.unitPriceCents))}</td></tr>
          ))}
        </tbody>
      </table>
      <p>Estimated tax {usd(quote.taxCents)}. Estimated total {usd(quote.totalCents)}. The invoice is the official tax figure.</p>
    </article>
  );
}
