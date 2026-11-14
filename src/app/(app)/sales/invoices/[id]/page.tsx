import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatDate, formatQty, usd } from "@/lib/format";
import { INVOICE_LABEL } from "@/lib/labels";
import { invoicePay } from "@/server/work-actions";

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
  return (
    <>
      <h1>Invoice {invoice.number}</h1>
      <p className="lede">{invoice.party.name} · {INVOICE_LABEL[invoice.status]} · due {formatDate(invoice.dueOn)}</p>
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
      <p>Sales {usd(invoice.subtotalCents)}. Tax {usd(invoice.taxCents)}. Total {usd(invoice.totalCents)}. Still open {usd(invoice.balanceCents)}.</p>
      {invoice.exemptionApplied && <p>Tax exemption {invoice.exemptionNumber} was applied.</p>}
      {invoice.feeCents > 0 && <p>Fees of {usd(invoice.feeCents)} were taken out of what is still owed.</p>}
      <p><Link className="btn secondary" href={`/print/invoice/${invoice.id}`}>Print</Link></p>
      {invoice.balanceCents > 0 && (
        <form action={invoicePay}>
          <input type="hidden" name="id" value={invoice.id} />
          <h2>Record a payment</h2>
          <div className="grid-2">
            <label className="field">Amount<input name="amount" defaultValue={(invoice.balanceCents / 100).toFixed(2)} required /></label>
            <label className="field">Date<input type="date" name="paidOn" defaultValue={todayInput()} required /></label>
            <label className="field">Method
              <select name="method" defaultValue="Check"><option>Check</option><option>ACH</option><option>Card</option><option>Cash</option></select>
            </label>
            <label className="field">Check or confirmation<input name="reference" required /></label>
          </div>
          <button className="btn" type="submit">Record the payment</button>
        </form>
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
