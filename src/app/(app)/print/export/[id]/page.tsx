import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ExportDocsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { party: true, lines: true },
  });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  if (!invoice || !company || invoice.channel !== "EXPORT") notFound();
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print the export set" /></p>
      <h1>Commercial invoice {invoice.number}</h1>
      <p>{company.legalName}, {company.city}, {company.state}, USA. Currency {invoice.currency}. No US sales tax.</p>
      <p>Sold to {invoice.party.name}, {invoice.party.billCity}, {invoice.party.billState}.</p>
      <p>{invoice.incoterm} {invoice.namedPlace}. Date {formatDate(invoice.issuedOn)}.</p>
      <table>
        <thead><tr><th>Description</th><th>Quantity</th><th>Amount</th></tr></thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td>{formatQty(Number(line.qty))}</td>
              <td>{usd(Math.round(Number(line.qty) * line.unitPriceCents))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Total {usd(invoice.totalCents)}.</p>
      <h1>Packing list {invoice.number}</h1>
      <table>
        <thead><tr><th>Description</th><th>Quantity</th></tr></thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}><td>{line.description}</td><td>{formatQty(Number(line.qty))}</td></tr>
          ))}
        </tbody>
      </table>
      <h1>Certificate of origin</h1>
      <p>The goods on invoice {invoice.number} were manufactured or packed by {company.legalName} in {company.city}, {company.state}, United States of America, unless a line says otherwise.</p>
      <p>Incoterms 2020: {invoice.incoterm} {invoice.namedPlace}. This certificate is for the buyer in the Caribbean or Mexico. It is not a customs filing.</p>
    </article>
  );
}
