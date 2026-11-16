import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { toDateInput, todayInput } from "@/lib/dates";
import { formatDate, formatQty, usd } from "@/lib/format";
import { earlyPayOffer, termsLabel } from "@/lib/commercial";
import { INVOICE_LABEL } from "@/lib/labels";
import { invoicePay, invoiceVoid } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { party: true, lines: true, applications: { include: { payment: true } } },
  });
  if (!invoice) notFound();
  const offer = earlyPayOffer({
    goodsNetCents: invoice.goodsNetCents,
    earlyPayBps: invoice.earlyPayBps,
    earlyPayDays: invoice.earlyPayDays,
    issuedOn: toDateInput(invoice.issuedOn),
    asOf: todayInput(),
    balanceCents: invoice.balanceCents,
  });
  return (
    <>
      <h1>Invoice {invoice.number}</h1>
      <p className="lede">{invoice.party.name} · {INVOICE_LABEL[invoice.status] ?? invoice.status} · due {formatDate(invoice.dueOn)}</p>
      <p>{invoice.incoterm}{invoice.namedPlace ? ` ${invoice.namedPlace}` : ""}. {termsLabel({ term: invoice.creditTerm, customNetDays: invoice.customNetDays, earlyPayBps: invoice.earlyPayBps, earlyPayDays: invoice.earlyPayDays })}. Currency {invoice.currency}.</p>
      {invoice.marketplaceOrderId && <p>Marketplace order {invoice.marketplaceOrderId}.</p>}
      {invoice.channel === "AMAZON" && <p>Amazon {invoice.fulfillment === "FBM" ? "FBM — stock stays in the SPER warehouse until it ships" : "FBA — stock is at Amazon"}.</p>}
      {invoice.channel === "EXPORT" && <p><Link href={`/print/export/${invoice.id}`}>Commercial invoice, packing list, and certificate of origin</Link>. No US sales tax.</p>}
      {invoice.orderId && <p><Link href={`/sales/orders/${invoice.orderId}`}>Order</Link>{invoice.deliveryId ? <> · <Link href={`/sales/deliveries/${invoice.deliveryId}`}>Delivery</Link></> : null}</p>}
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th>Quantity</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td>{formatQty(Number(line.qty))}</td>
              <td>{usd(line.unitPriceCents)}</td>
              <td>{usd(Math.round(Number(line.qty) * line.unitPriceCents))}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p>Goods after discount {usd(invoice.goodsNetCents)}. Discounts {usd(invoice.discountCents)}. Freight {usd(invoice.freightCents)}. Insurance {usd(invoice.insuranceCents)}. Tax {usd(invoice.taxCents)}. Total {usd(invoice.totalCents)}. Still open {usd(invoice.balanceCents)}.</p>
      {invoice.balanceCents > 0 && <div className={offer.available ? "banner good" : "banner"}>{offer.message}</div>}
      {invoice.exemptionApplied && <p>Tax exemption {invoice.exemptionNumber} was applied.</p>}
      {invoice.feeCents > 0 && <p>Fees of {usd(invoice.feeCents)} were taken out of what is still owed.</p>}
      <p><Link className="btn secondary" href={`/print/invoice/${invoice.id}`}>Print</Link></p>
      {invoice.balanceCents > 0 && invoice.status !== "VOID" && (
        <form action={invoicePay}>
          <input type="hidden" name="id" value={invoice.id} />
          <h2>Record a payment</h2>
          <div className="grid-2">
            <label className="field">Amount<input name="amount" defaultValue={(offer.payCents / 100).toFixed(2)} required /></label>
            <label className="field">Date<input type="date" name="paidOn" defaultValue={todayInput()} required /></label>
            <label className="field">Method
              <select name="method" defaultValue="Check"><option>Check</option><option>ACH</option><option>Card</option><option>Cash</option></select>
            </label>
            <label className="field">Check or confirmation<input name="reference" required /></label>
          </div>
          <button className="btn" type="submit">Record the payment</button>
        </form>
      )}
      {invoice.status === "OPEN" && invoice.applications.length === 0 && (
        <form action={invoiceVoid}><input type="hidden" name="id" value={invoice.id} /><button className="btn secondary" type="submit">Void this invoice</button></form>
      )}
      {invoice.applications.length > 0 && (
        <>
          <h2>Payments</h2>
          <ul>{invoice.applications.map((row) => <li key={row.id}>{row.payment.number} · {usd(row.amountCents)} · {row.payment.reference}</li>)}</ul>
        </>
      )}
    </>
  );
}
