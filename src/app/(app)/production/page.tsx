import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, formatQty } from "@/lib/format";
import { BATCH_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const batches = await prisma.productionBatch.findMany({ include: { product: true }, orderBy: { number: "desc" } });
  return (
    <>
      <div className="row"><h1>Production</h1><Link className="btn" href="/production/new">Plan a batch</Link></div>
      <p className="lede">A batch can start only when the recipe cost is complete, including every sub-recipe.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Batch</th><th>Product</th><th>Quantity</th><th>Status</th><th>Finished</th></tr></thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id}>
              <td><Link href={`/production/${batch.id}`}>{batch.number}</Link></td>
              <td>{batch.product.name}</td>
              <td>{formatQty(Number(batch.actualQty ?? batch.plannedQty), batch.product.unit)}</td>
              <td>{BATCH_LABEL[batch.status]}</td>
              <td>{formatDate(batch.closedOn)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
