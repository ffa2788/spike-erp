import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatQty, usd } from "@/lib/format";
import { PO_LABEL } from "@/lib/labels";
import { poCancel, poReceive } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function PoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { party: true, lines: { include: { product: true } }, receipts: true },
  });
  if (!order) notFound();
  const receivable = order.status === "SENT" || order.status === "PARTLY_RECEIVED";
  return (
    <>
      <h1>Purchase order {order.number}</h1>
      <p className="lede">{order.party.name} · {PO_LABEL[order.status]}</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Material</th><th>Ordered</th><th>Received</th><th>Price</th></tr></thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td>{formatQty(Number(line.qty), line.product.unit)}</td>
              <td>{formatQty(Number(line.qtyReceived), line.product.unit)}</td>
              <td>{usd(line.unitPriceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p><Link href={`/print/po/${order.id}`}>Print</Link></p>
      <h2>Receipts</h2>
      <ul>{order.receipts.map((receipt) => <li key={receipt.id}><Link href={`/purchasing/receipts/${receipt.id}`}>{receipt.number}</Link></li>)}</ul>
      {receivable && (
        <form action={poReceive}>
          <input type="hidden" name="id" value={order.id} />
          <h2>Receive goods</h2>
          <p>Received lots wait in quarantine until quality releases them.</p>
          <label className="field">Date received<input type="date" name="receivedOn" defaultValue={todayInput()} required /></label>
          {order.lines.map((line) => {
            const remaining = Number(line.qty) - Number(line.qtyReceived);
            if (remaining <= 0) return null;
            return (
              <div className="grid-3" key={line.id}>
                <input type="hidden" name="orderLineId" value={line.id} />
                <label className="field">{line.description}<span>{formatQty(remaining, line.product.unit)} still open</span>
                  <input name="qty" defaultValue={String(remaining)} />
                </label>
                <label className="field">Supplier lot<input name="supplierLot" required /></label>
                <label className="field">Expires<input type="date" name="expiresOn" /></label>
              </div>
            );
          })}
          <button className="btn" type="submit">Receive these goods</button>
        </form>
      )}
      {order.receipts.length === 0 && order.status !== "CANCELLED" && (
        <form action={poCancel}>
          <input type="hidden" name="id" value={order.id} />
          <label className="field"><input type="checkbox" name="confirm" value="yes" /> I want to cancel this purchase order.</label>
          <button className="btn secondary" type="submit">Cancel</button>
        </form>
      )}
    </>
  );
}
