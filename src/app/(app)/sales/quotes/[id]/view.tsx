import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, formatQty, usd } from "@/lib/format";
import { QUOTE_LABEL } from "@/lib/labels";
import { termsLabel } from "@/lib/commercial";
import { quoteAccept, quoteMark, quoteRevise } from "@/server/work-actions";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { party: true, lines: { include: { product: true } }, order: true },
  });
  if (!quote) notFound();
  return (
    <>
      <h1>Quote {quote.number} rev {quote.revision}</h1>
      <p className="lede">{quote.party.name} · {QUOTE_LABEL[quote.status] ?? quote.status} · {quote.currency} · {usd(quote.totalCents)}</p>
      <p>{quote.incoterm} {quote.namedPlace}. {termsLabel({ term: quote.creditTerm, customNetDays: quote.customNetDays, earlyPayBps: quote.earlyPayBps, earlyPayDays: quote.earlyPayDays })}. Good until {formatDate(quote.validUntil)}.</p>
      {quote.freightCents > 0 && <p>Freight {usd(quote.freightCents)} is included because {quote.incoterm} puts freight on SPER.</p>}
      {quote.insuranceCents > 0 && <p>Insurance {usd(quote.insuranceCents)} is included because {quote.incoterm} puts insurance on SPER.</p>}
      {quote.discountCents > 0 && <p>Discounts {usd(quote.discountCents)}. Goods after discount {usd(quote.goodsNetCents)}.</p>}
      {quote.earlyPayBps > 0 && <p>Early-payment discount is available on the invoice if they pay within {quote.earlyPayDays} days.</p>}
      <Flash error={query.error} notice={query.notice} />
      <p>The tax on a quote is an estimate. The invoice is the official figure.</p>
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th>Quantity</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>
          {quote.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td>{formatQty(Number(line.qty), line.product.unit)}</td>
              <td>{usd(line.unitPriceCents)}</td>
              <td>{usd(Math.round(Number(line.qty) * line.unitPriceCents))}{line.discountCents ? ` less ${usd(line.discountCents)}` : ""}{line.priceSource ? ` · ${line.priceSource}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p>Estimated tax {usd(quote.taxCents)}. Estimated total {usd(quote.totalCents)}. Good until {formatDate(quote.validUntil)}.</p>
      <div className="row">
        <Link className="btn secondary" href={`/print/quote/${quote.id}`}>Print</Link>
        {quote.order && <Link className="btn" href={`/sales/orders/${quote.order.id}`}>Open the order</Link>}
      </div>
      {!quote.order && quote.status !== "REJECTED" && quote.status !== "EXPIRED" && quote.status !== "SUPERSEDED" && (
        <div className="row" style={{ marginTop: "1rem" }}>
          <form action={quoteAccept}><input type="hidden" name="id" value={quote.id} /><button className="btn" type="submit">Accept and create the order</button></form>
          <form action={quoteMark}><input type="hidden" name="id" value={quote.id} /><input type="hidden" name="status" value="SENT" /><button className="btn secondary" type="submit">Mark as sent</button></form>
          <form action={quoteMark}><input type="hidden" name="id" value={quote.id} /><input type="hidden" name="status" value="REJECTED" /><button className="btn secondary" type="submit">Reject</button></form>
          <form action={quoteRevise}><input type="hidden" name="id" value={quote.id} /><button className="btn secondary" type="submit">Make revision {quote.revision === "Z" ? "" : String.fromCharCode(quote.revision.charCodeAt(0) + 1)}</button></form>
        </div>
      )}
    </>
  );
}
