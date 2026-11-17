import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { ORDER_LABEL } from "@/lib/labels";
import { orderCancel, orderShip } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { party: true, lines: { include: { product: true, deliveryLines: true } }, deliveries: { include: { invoice: true } }, invoices: true },
  });
  if (!order) notFound();
  const open = order.status === "CONFIRMED" || order.status === "PARTLY_SHIPPED";
  return (
    <>
      <h1>Order {order.number}</h1>
      <p className="lede">{order.party.name} · {ORDER_LABEL[order.status]} · {order.incoterm} {order.namedPlace}</p>
      {order.invoices.length > 0 && <p>Invoices: {order.invoices.map((invoice) => <Link key={invoice.id} href={`/sales/invoices/${invoice.id}`}>{invoice.number}</Link>)}</p>}
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th>Ordered</th><th>Shipped</th></tr></thead>
        <tbody>
          {order.lines.map((line) => {
            const shipped = line.deliveryLines.reduce((sum, item) => sum + Number(item.qty), 0);
            return (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{formatQty(Number(line.qty), line.product.unit)}</td>
                <td>{formatQty(shipped, line.product.unit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <h2>Shipments</h2>
      {order.deliveries.length === 0 && <p>Nothing has shipped yet.</p>}
      <ul>
        {order.deliveries.map((delivery) => (
          <li key={delivery.id}><Link href={`/sales/deliveries/${delivery.id}`}>{delivery.number}</Link></li>
        ))}
      </ul>
      {open && (
        <form action={orderShip}>
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="shipAll" value="yes" />
          <p>SPIKE will use the oldest released lots that have not expired. Lots waiting for quality are skipped. An NSF/ANSI 60 product ships only when the certificate and formula still match.</p>
          <div className="grid-2">
            <label className="field">Ship date<input type="date" name="shippedOn" defaultValue={todayInput()} required /></label>
            <label className="field">Carrier<input name="carrier" /></label>
          </div>
          <label className="field">Tracking<input name="tracking" /></label>
          <button className="btn" type="submit">Ship what is still open</button>
        </form>
      )}
      {order.deliveries.length === 0 && order.status !== "CANCELLED" && (
        <form action={orderCancel}>
          <input type="hidden" name="id" value={order.id} />
          <label className="field"><span>Cancel</span><input type="checkbox" name="confirm" value="yes" /> I want to cancel this order.</label>
          <button className="btn secondary" type="submit">Cancel this order</button>
        </form>
      )}
      <p><Link href={`/print/order/${order.id}`}>Print the order</Link></p>
    </>
  );
}
