import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatDate, usd } from "@/lib/format";
import { INVOICE_LABEL } from "@/lib/labels";
import { billPay } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const bill = await prisma.vendorBill.findUnique({
    where: { id },
    include: { party: true, lines: true, payments: true },
  });
  if (!bill) notFound();
  return (
    <>
      <h1>Bill {bill.number}</h1>
      <p className="lede">{bill.party.name} · their invoice {bill.vendorRef} · {INVOICE_LABEL[bill.status]} · due {formatDate(bill.dueOn)}</p>
      <Flash error={query.error} notice={query.notice} />
      <p>Total {usd(bill.totalCents)}. Still open {usd(bill.balanceCents)}.</p>
      <ul>{bill.lines.map((line) => <li key={line.id}>{line.description} · {usd(Math.round(Number(line.qty) * line.unitPriceCents))}</li>)}</ul>
      {bill.balanceCents > 0 && (
        <form action={billPay}>
          <input type="hidden" name="id" value={bill.id} />
          <h2>Pay this bill</h2>
          <div className="grid-2">
            <label className="field">Amount<input name="amount" defaultValue={(bill.balanceCents / 100).toFixed(2)} required /></label>
            <label className="field">Date<input type="date" name="paidOn" defaultValue={todayInput()} required /></label>
            <label className="field">Method<select name="method" defaultValue="Check"><option>Check</option><option>ACH</option><option>Card</option></select></label>
            <label className="field">Check or confirmation<input name="reference" required /></label>
          </div>
          <button className="btn" type="submit">Record the payment</button>
        </form>
      )}
      <ul>{bill.payments.map((payment) => <li key={payment.id}>{payment.number} · {usd(payment.amountCents)} · {payment.reference}</li>)}</ul>
    </>
  );
}
