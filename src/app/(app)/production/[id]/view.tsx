import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatQty, usdPrecise } from "@/lib/format";
import { BATCH_LABEL } from "@/lib/labels";
import { batchFinish, batchStart } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const batch = await prisma.productionBatch.findUnique({
    where: { id },
    include: {
      product: true,
      formula: { include: { lines: { include: { ingredient: true } } } },
      consumptions: { include: { lot: true } },
      outputLot: true,
    },
  });
  if (!batch) notFound();
  return (
    <>
      <h1>Batch {batch.number}</h1>
      <p className="lede">{batch.product.name} · formula version {batch.formulaVersion} · {BATCH_LABEL[batch.status]}</p>
      <Flash error={query.error} notice={query.notice} />
      <h2>Recipe for {formatQty(Number(batch.plannedQty), batch.product.unit)}</h2>
      <ul>
        {batch.formula.lines.map((line) => (
          <li key={line.id}>
            {line.ingredient.name} · {Number(line.percent)}% · {formatQty((Number(batch.plannedQty) * Number(line.percent)) / 100, line.ingredient.unit)}
            {line.ingredient.kind === "UTILITY" ? " · utility, not stored" : ""}
          </li>
        ))}
      </ul>
      {batch.consumptions.length > 0 && (
        <>
          <h2>What was used</h2>
          <ul>
            {batch.consumptions.map((row) => (
              <li key={row.id}>
                {row.lot ? <Link href={`/inventory/${row.lotId}`}>{row.lot.lotNumber}</Link> : "Utility"} · {formatQty(Number(row.qty))} · {usdPrecise(Number(row.unitCost))} each
              </li>
            ))}
          </ul>
        </>
      )}
      {batch.status === "PLANNED" && (
        <form action={batchStart}>
          <input type="hidden" name="id" value={batch.id} />
          <label className="field">Start date<input type="date" name="startedOn" defaultValue={todayInput()} required /></label>
          <button className="btn" type="submit">Start and consume materials</button>
        </form>
      )}
      {batch.status === "IN_PROCESS" && (
        <form action={batchFinish}>
          <input type="hidden" name="id" value={batch.id} />
          <p>Ingredients were weighed for the planned quantity. If the yield is different, the cost per unit changes.</p>
          <div className="grid-2">
            <label className="field">Quantity made<input name="actualQty" defaultValue={String(Number(batch.plannedQty))} required /></label>
            <label className="field">Date<input type="date" name="closedOn" defaultValue={todayInput()} required /></label>
          </div>
          <button className="btn" type="submit">Finish and create the lot</button>
        </form>
      )}
      {batch.outputLot && <p><Link className="btn" href={`/inventory/${batch.outputLot.id}`}>Open lot {batch.outputLot.lotNumber}</Link></p>}
    </>
  );
}
