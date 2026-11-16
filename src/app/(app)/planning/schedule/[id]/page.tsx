import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty } from "@/lib/format";
import { toDateInput } from "@/lib/dates";
import { workListTable } from "@/lib/work-list-mail";

export const dynamic = "force-dynamic";

const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function ReleasedSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const release = await prisma.scheduleRelease.findUnique({ where: { id }, include: { lines: { orderBy: { dueOn: "asc" } } } });
  if (!release) notFound();
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  const preview = workListTable({
    number: release.number,
    weekOf: toDateInput(release.weekOf),
    lines: release.lines.map((line) => ({
      dueOn: toDateInput(line.dueOn),
      sku: line.sku,
      name: line.name,
      packageLabel: line.packageLabel,
      qty: formatQty(Number(line.qty)),
      fbaQty: formatQty(Number(line.fbaQty)),
      unit: line.unit,
      materials: line.materials.replaceAll("\n", "; "),
      shortage: line.shortage,
    })),
  });
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print or save as PDF" /></p>
      <h1>Work list {release.number}</h1>
      <p>For Trevor. Week of {formatDate(release.weekOf)}. History window {release.windowWeeks} weeks.</p>
      <h2>Email to Trevor</h2>
      <p>To: {release.emailedTo || company?.trevorEmail || "Add Trevor's email in Settings."}</p>
      <p>Subject: {preview.subject}</p>
      <p>Attached: {release.number}.pdf</p>
      <pre>{preview.text}</pre>
      {release.lines.map((line) => {
        const due = line.dueOn.toISOString().slice(0, 10);
        return (
          <section key={line.id}>
            <h2>{dayName[new Date(`${due}T00:00:00Z`).getUTCDay()]} {formatDate(line.dueOn)}</h2>
            <p><strong>{line.sku}</strong> {line.name} · {line.packageLabel}</p>
            <p>Make {formatQty(Number(line.qty), line.unit)}. Ship to FBA {formatQty(Number(line.fbaQty), line.unit)}.</p>
            <p>Formula version {line.formulaVersion ?? "none"}. Pull lot {line.pullLot || "assign when the batch starts"}.</p>
            <p>Days of cover {line.daysCover == null ? "not calculated" : Number(line.daysCover)}.</p>
            <p>Materials to pull:</p>
            <p>{line.materials || "None listed."}</p>
            {line.shortage && <p>A material is short. Do not start until it is in the supermarket.</p>}
          </section>
        );
      })}
    </article>
  );
}
