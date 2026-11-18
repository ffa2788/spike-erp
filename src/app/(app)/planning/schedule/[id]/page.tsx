import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/dates";
import { buildPlan, planDocumentHtml } from "@/lib/work-list-mail";

export const dynamic = "force-dynamic";

export default async function ReleasedSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const release = await prisma.scheduleRelease.findUnique({ where: { id }, include: { lines: { orderBy: { dueOn: "asc" } } } });
  if (!release) notFound();
  const plan = buildPlan({
    number: release.number,
    weekOf: toDateInput(release.weekOf),
    releasedOn: toDateInput(release.createdAt),
    releasedBy: "",
    lines: release.lines.map((line) => ({
      dueOn: toDateInput(line.dueOn),
      sku: line.sku,
      name: line.name,
      packageLabel: line.packageLabel,
      qty: Number(line.qty),
      fbaQty: Number(line.fbaQty),
      unit: line.unit,
      formulaVersion: line.formulaVersion,
      daysCover: line.daysCover == null ? null : Number(line.daysCover),
      shortage: line.shortage,
      materials: line.materials,
    })),
  });
  const html = planDocumentHtml(plan, "/brand/logo.png");
  return (
    <>
      <p className="no-print"><PrintButton label="Print or save as PDF" /> <Link href={`/planning/schedule/${release.id}/email`}>Email preview</Link></p>
      <style>{`
        .plan-sheet { max-width: none; background: white; padding: 0; }
        .plan-sheet .plan { font-size: 13px; }
        @media print {
          @page { size: letter landscape; margin: 0.25in; }
          .plan-sheet { font-size: 11px; }
        }
      `}</style>
      <article className="plan-sheet" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
