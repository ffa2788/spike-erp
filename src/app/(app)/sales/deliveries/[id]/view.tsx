import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { deliveryInvoice } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function DeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: { order: { include: { party: true } }, lines: { include: { lot: true, orderLine: { include: { product: true } } } }, invoice: true },
  });
  if (!delivery) notFound();
  return (
    <>
      <h1>Delivery {delivery.number}</h1>
      <p className="lede">{delivery.order.party.name} · order {delivery.order.number}{delivery.invoice ? <> · invoice <Link href={`/sales/invoices/${delivery.invoice.id}`}>{delivery.invoice.number}</Link></> : null}</p>
      <Flash error={query.error} notice={query.notice} />
      <p>The cost of these goods has already left inventory. Create the invoice to record the sale.</p>
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th>Lot</th><th>Quantity</th></tr></thead>
        <tbody>
          {delivery.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.orderLine.description}</td>
              <td><Link href={`/inventory/${line.lotId}`}>{line.lot.lotNumber}</Link></td>
              <td>{formatQty(Number(line.qty), line.orderLine.product.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p><Link className="btn secondary" href={`/print/delivery/${delivery.id}`}>Print the delivery note</Link></p>
      {delivery.invoice ? (
        <p><Link className="btn" href={`/sales/invoices/${delivery.invoice.id}`}>Open invoice {delivery.invoice.number}</Link></p>
      ) : (
        <form action={deliveryInvoice}>
          <input type="hidden" name="id" value={delivery.id} />
          <label className="field">Invoice date<input type="date" name="issuedOn" defaultValue={todayInput()} required /></label>
          <button className="btn" type="submit">Create the invoice</button>
        </form>
      )}
    </>
  );
}
