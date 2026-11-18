import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatQty, usd } from "@/lib/format";
import { QC_LABEL } from "@/lib/labels";
import { receiptBill } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { order: { include: { party: true } }, lines: { include: { lot: true, orderLine: { include: { product: true } } } }, bill: true },
  });
  if (!receipt) notFound();
  return (
    <>
      <h1>Receipt {receipt.number}</h1>
      <p className="lede">{receipt.order.party.name} · {receipt.order.number}</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Material</th><th>Lot</th><th>Quality</th><th>Quantity</th></tr></thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.orderLine.description}</td>
              <td><Link href={`/inventory/${line.lotId}`}>{line.lot.lotNumber}</Link></td>
              <td>{QC_LABEL[line.lot.qcStatus]}</td>
              <td>{formatQty(Number(line.qty), line.orderLine.product.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {receipt.bill ? <p><Link className="btn" href={`/purchasing/bills/${receipt.bill.id}`}>Open bill {receipt.bill.number}</Link></p> : (
        <form action={receiptBill}>
          <input type="hidden" name="id" value={receipt.id} />
          <h2>Enter the supplier bill</h2>
          <div className="grid-2">
            <label className="field">Supplier invoice number<input name="vendorRef" required /></label>
            <label className="field">Bill date<input type="date" name="billedOn" defaultValue={todayInput()} required /></label>
          </div>
          {receipt.lines.map((line) => (
            <label className="field" key={line.id}>
              {line.orderLine.description} price each
              <input type="hidden" name="receiptLineId" value={line.id} />
              <input name="unitPrice" defaultValue={(line.orderLine.unitPriceCents / 100).toFixed(2)} />
              <span>Receipt value {usd(Math.round(Number(line.qty) * line.orderLine.unitPriceCents))}. A different bill price is posted as a price difference.</span>
            </label>
          ))}
          <button className="btn" type="submit">Save the bill</button>
        </form>
      )}
    </>
  );
}
