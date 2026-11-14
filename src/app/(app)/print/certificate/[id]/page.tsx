import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty } from "@/lib/format";
import { currentStock } from "@/lib/read-models";
import { lotQty } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function PrintCertificate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lot = await prisma.lot.findUnique({
    where: { id },
    include: { product: true, qcResults: true, outputOf: { include: { consumptions: { include: { lot: { include: { product: true } } } } } } },
  });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  const stock = await currentStock();
  if (!lot || !company) notFound();
  const balance = stock.find((item) => item.lotId === lot.id);
  const released = lot.qcStatus === "APPROVED";
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print this certificate" /></p>
      {lot.isExample && <p className="watermark">EXAMPLE — NOT A REAL CERTIFICATE</p>}
      <h1>Lot certificate</h1>
      <p>This lot was made or received by {company.legalName} in {company.city}, {company.state}.</p>
      <p>Product {lot.product.name}. Lot {lot.lotNumber}. Quantity on hand {formatQty(balance ? lotQty(balance) : 0, lot.product.unit)}.</p>
      <p>Date {formatDate(lot.manufacturedOn ?? lot.receivedOn)}. Formula version {lot.formulaVersion ?? "—"}.</p>
      {!released && <p><strong>This lot is not released. Do not use this certificate for a shipment.</strong></p>}
      {released && lot.nsfEligible && (
        <p>NSF/ANSI 60 claim: {lot.product.nsfClaim} Certificate {lot.product.nsfCertNumber}, through {formatDate(lot.product.nsfExpiresOn)}.</p>
      )}
      {released && !lot.nsfEligible && <p>This lot does not carry an NSF/ANSI 60 claim.</p>}
      <h2>Quality results</h2>
      {lot.qcResults.length === 0 && <p>No results recorded.</p>}
      <ul>{lot.qcResults.map((result) => <li key={result.id}>{result.parameter}: {Number(result.value)} {result.unit} ({result.passed ? "pass" : "fail"})</li>)}</ul>
      {lot.outputOf && (
        <>
          <h2>Materials in the batch</h2>
          <ul>
            {lot.outputOf.consumptions.map((row) => (
              <li key={row.id}>{row.lot ? `${row.lot.product.name} lot ${row.lot.lotNumber}` : "Utility"} · {formatQty(Number(row.qty))}</li>
            ))}
          </ul>
          <p>Batch {lot.outputOf.number}. Operator {lot.outputOf.operatorName || "—"}.</p>
        </>
      )}
      {released && <p>Released by {lot.releasedBy || "—"} on {formatDate(lot.releasedOn)}.</p>}
      <p>Signature ___________________________</p>
    </article>
  );
}
