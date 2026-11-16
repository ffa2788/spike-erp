import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/dates";
import { buildPlan, planEmailHtml, planPlainText } from "@/lib/work-list-mail";

export const dynamic = "force-dynamic";

export default async function ScheduleEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const release = await prisma.scheduleRelease.findUnique({ where: { id }, include: { lines: true } });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
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
  const to = release.emailedTo || company?.trevorEmail || "Add Trevor's email in Settings.";
  return (
    <>
      <p className="no-print">Sent to {to}. The PDF is attached. <Link href={`/planning/schedule/${release.id}`}>Open the printable plan</Link></p>
      <div id="trevor-email" dangerouslySetInnerHTML={{ __html: planEmailHtml(plan) }} />
      <h2 className="no-print">Plain-text fallback</h2>
      <pre className="no-print" style={{ whiteSpace: "pre-wrap" }}>{planPlainText(plan)}</pre>
    </>
  );
}
