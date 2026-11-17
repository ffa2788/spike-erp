import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { suggestAmazonSku } from "@/lib/amazon-reports";
import { usd } from "@/lib/format";
import { amazonMarginView } from "@/lib/services/amazon-payments-import";
import { importFbaAction, importOrdersAction, importPaymentsAction, importSettlementAction, mapAmazonSkuAction } from "@/server/amazon-file-actions";

export const dynamic = "force-dynamic";

export default async function AmazonImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const [products, maps, unmappedItems, margin, invoiceCount, settlements] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.amazonSkuMap.findMany({ include: { product: true }, orderBy: { amazonSku: "asc" } }),
    prisma.amazonOrderItem.findMany({ where: { productId: null, cancelled: false }, orderBy: { sku: "asc" } }),
    amazonMarginView(),
    prisma.invoice.count({ where: { channel: "AMAZON", status: { not: "VOID" } } }),
    prisma.amazonSettlementLine.findMany({ select: { type: true, totalCents: true, sellingFeeCents: true, fbaFeeCents: true } }),
  ]);
  const depositCents = settlements.filter((line) => line.type.trim().toLowerCase() === "transfer").reduce((sum, line) => sum - line.totalCents, 0);
  const feeCents = settlements.reduce((sum, line) => sum + Math.abs(Math.min(0, line.sellingFeeCents)) + Math.abs(Math.min(0, line.fbaFeeCents)), 0);
  const refunds = settlements.filter((line) => /refund/i.test(line.type)).length;
  const unmapped = new Map<string, { sku: string; asin: string }>();
  for (const row of unmappedItems) unmapped.set(row.sku, { sku: row.sku, asin: row.asin });
  for (const row of maps) if (!row.productId) unmapped.set(row.amazonSku, { sku: row.amazonSku, asin: row.asin });
  return (
    <>
      <h1>Amazon reports</h1>
      <p className="lede">
        Chris does not type Amazon orders. Upload the Seller Central reports, or let the SPIKE bot post the same files.
        Buyer names are not stored. Every Amazon sale is the customer Amazon Customer. FBA and FBM stay on A- invoices.
      </p>
      <p><Link href="/sales?tab=week">Open Amazon week</Link></p>
      <Flash error={query.error} notice={query.notice} />
      <div id="amazon-summary" className="banner">
        On file: {invoiceCount} A- invoices, {refunds} refunds, {usd(feeCents)} fees, deposit {usd(depositCents)}.
        {query.notice ? ` Last import: ${query.notice}` : " Upload a report below, or POST the same files to /api/amazon/import."}
      </div>
      <p><Link href="/sales?tab=week">Open Amazon week</Link></p>
      <h2>All Orders</h2>
      <p>One row per item. You can upload several 30-day files. The same order item keeps the newer last-updated date. Cancelled rows are not sales. Shipped rows that map to a product become A- invoices and count in the production schedule.</p>
      <form action={importOrdersAction}>
        <label className="field">Report file<input type="file" name="file" accept=".txt,.tsv,.csv" /></label>
        <label className="field">Or paste<textarea name="csv" /></label>
        <button className="btn" type="submit">Import orders</button>
      </form>
      <h2>Manage FBA Inventory</h2>
      <p>Fulfillable stock is the available column. Inbound is inbound-working plus inbound-shipped plus inbound-received. Those quantities feed the production schedule.</p>
      <form action={importFbaAction}>
        <label className="field">Report file<input type="file" name="file" accept=".txt,.tsv,.csv" /></label>
        <label className="field">Or paste<textarea name="csv" /></label>
        <button className="btn" type="submit">Import FBA inventory</button>
      </form>
      <h2>Payments date range</h2>
      <p>This is Amazon's transaction CSV. The first lines are a preamble. SPIKE starts at the row that begins with date/time. Upload overlapping files and the same transaction is kept once. Fees in the file are negative.</p>
      <form action={importPaymentsAction}>
        <label className="field">Report file<input type="file" name="file" accept=".txt,.tsv,.csv" /></label>
        <label className="field">Or paste<textarea name="csv" /></label>
        <button className="btn" type="submit">Import payments</button>
      </form>
      <h2>Settlement flat file</h2>
      <p>The tab-separated settlement report from Seller Central. The same deposit and fees post once if you also upload the payments date range file.</p>
      <form action={importSettlementAction}>
        <label className="field">Report file<input type="file" name="file" accept=".txt,.tsv,.csv" /></label>
        <label className="field">Or paste<textarea name="csv" /></label>
        <button className="btn" type="submit">Import settlement</button>
      </form>
      <div id="amazon-margin">
      <h2>Amazon margin by SKU</h2>
      <p>
        Net margin is product sales, minus Amazon fees, minus the formula and packaging cost.
        The referral fee and the FBA fee are the average per unit on Order rows.
        FBM label costs follow the order. The subscription, ads, and storage are spread by product sales. Refunds stay on their SKU.
        {margin.lineCount > 0 ? ` ${margin.lineCount} payment rows are on file. Payouts to the bank total ${usd(margin.payoutCents)}. Match those deposits on Check the bank.` : ""}
      </p>
        <div className="wrap"><table>
          <thead>
            <tr><th>Amazon SKU</th><th>SPIKE product</th><th>Units</th><th>Product sales</th><th>Amazon fees</th><th>Formula + packaging</th><th>Net margin</th></tr>
          </thead>
          <tbody>
            {margin.margins.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.productSku ? `${row.productSku} ${row.productName}` : row.productName || "Unmapped"}</td>
                <td>{row.netUnits}</td>
                <td>{usd(row.productSalesCents)}</td>
                <td>{usd(row.feeExpenseCents)}</td>
                <td>{row.costCents == null ? "Not costed" : usd(row.costCents)}</td>
                <td>{row.marginCents == null ? "Not costed" : usd(row.marginCents)}</td>
              </tr>
            ))}
            {margin.margins.length === 0 && <tr><td colSpan={7}>No payments report imported yet.</td></tr>}
          </tbody>
        </table></div>
        <h2>Fee detail</h2>
        <p>Referral and FBA fees are the average per unit sold on Order rows. Shipping labels follow the order. Subscription, ads, and storage are spread by product sales.</p>
        <div className="wrap"><table>
          <thead>
            <tr><th>Amazon SKU</th><th>Referral / unit</th><th>FBA fee / unit</th><th>Shipping</th><th>Subscription and ads</th><th>Storage</th><th>Refunds</th></tr>
          </thead>
          <tbody>
            {margin.margins.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.avgSellingFeePerUnitCents == null ? "—" : usd(row.avgSellingFeePerUnitCents)}</td>
                <td>{row.avgFbaFeePerUnitCents == null ? "—" : usd(row.avgFbaFeePerUnitCents)}</td>
                <td>{usd(row.shippingCents)}</td>
                <td>{usd(row.serviceCents)}</td>
                <td>{usd(row.storageCents)}</td>
                <td>{usd(-row.refundSalesCents)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <h2>Import summary</h2>
      {query.notice ? <p>{query.notice}</p> : <p>No file imported in this visit yet.</p>}
      <h2 id="amazon-exceptions">Exceptions</h2>
      <p>Amazon SKUs are matched after trimming spaces at the ends. A space in the middle, as in "SC-RP1-1.0-1 -FBA", is kept. Unmapped rows stay on this list.</p>
      <div className="wrap"><table>
        <thead><tr><th>Amazon SKU</th><th>ASIN</th><th>Suggestion</th><th>SPIKE product</th></tr></thead>
        <tbody>
          {[...unmapped.values()].map((row) => {
            const suggestion = suggestAmazonSku({ sku: row.sku, asin: row.asin, products });
            return (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.asin}</td>
                <td>{suggestion.label || "No suggestion"}</td>
                <td>
                  <form action={mapAmazonSkuAction} className="row">
                    <input type="hidden" name="amazonSku" value={row.sku} />
                    <select name="productId" defaultValue={suggestion.productId ?? ""}>
                      <option value="">Choose</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.sku} {product.name}</option>)}
                    </select>
                    <button className="btn secondary" type="submit">Map</button>
                  </form>
                </td>
              </tr>
            );
          })}
          {unmapped.size === 0 && <tr><td colSpan={4}>No unmapped SKUs.</td></tr>}
        </tbody>
      </table></div>
      <h2>Mapped SKUs</h2>
      <ul>
        {maps.filter((row) => row.product).map((row) => <li key={row.id}>{row.amazonSku} → {row.product?.sku} {row.product?.name}</li>)}
      </ul>
    </>
  );
}
