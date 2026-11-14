import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function Diamond({ kind }: { kind: string }) {
  const label = kind === "corrosion" ? "Corrosive" : kind === "health" ? "Health" : "Irritant";
  return (
    <svg className="diamond" viewBox="0 0 100 100" role="img" aria-label={label}>
      <rect x="18" y="18" width="64" height="64" transform="rotate(45 50 50)" fill="white" stroke="#9b1c1c" strokeWidth="6" />
      <text x="50" y="56" textAnchor="middle" fontSize="14" fill="#9b1c1c">{label.slice(0, 4)}</text>
    </svg>
  );
}

export default async function PrintLabel({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const pack = typeof query.pack === "string" ? query.pack : "product";
  const lot = await prisma.lot.findUnique({ where: { id }, include: { product: true } });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  if (!lot || !company) notFound();
  const icons = lot.product.ghsPictograms.split(",").map((item) => item.trim()).filter(Boolean);
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print this label" /></p>
      {lot.isExample && <p className="watermark">EXAMPLE LABEL</p>}
      <p>{company.legalName} · {company.city}, {company.state}</p>
      <h1>{lot.product.name}</h1>
      <p style={{ fontSize: "2rem" }}>Lot {lot.lotNumber}</p>
      <p>Pack: {pack}. Unit {lot.product.unit}. {lot.product.pack ? `Catalog pack ${lot.product.pack}.` : ""}</p>
      {lot.product.ghsSignal && <p><strong>{lot.product.ghsSignal}</strong></p>}
      <div className="row">{icons.map((icon) => <Diamond key={icon} kind={icon} />)}</div>
      <p>{lot.product.hazardStatements}</p>
      <p>{lot.product.precautionary}</p>
      {lot.nsfEligible && (
        <p>NSF/ANSI 60. Certificate {lot.product.nsfCertNumber}. {lot.product.nsfClaim}</p>
      )}
      <p>Expires {formatDate(lot.expiresOn)}</p>
    </article>
  );
}
