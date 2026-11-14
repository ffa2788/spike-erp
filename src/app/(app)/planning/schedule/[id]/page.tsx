import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatDate, formatQty } from "@/lib/format";

export const dynamic = "force-dynamic";

const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function ReleasedSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const release = await prisma.scheduleRelease.findUnique({ where: { id }, include: { lines: { orderBy: { dueOn: "asc" } } } });
  if (!release) notFound();
  return (
    <article className="paper">
      <p className="no-print"><PrintButton label="Print or save as PDF" /></p>
      <h1>Work list {release.number}</h1>
      <p>For Trevor. Week of {formatDate(release.weekOf)}. History window {release.windowWeeks} weeks.</p>
      {release.emailedTo && <p>Copy addressed to {release.emailedTo}.</p>}
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
