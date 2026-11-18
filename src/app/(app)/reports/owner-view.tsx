import Link from "next/link";
import { ProfitStatement } from "@/components/profit-statement";
import { usd } from "@/lib/format";
import { AGING_LABEL } from "@/lib/aging";
import { agingReport, balanceReport, customerReport, mrpReport, productReport, profitReport, salesReport, type ReportQuery } from "@/lib/services/owner-reports";

export async function OwnerReport({ kind, query, base }: { kind: string; query: ReportQuery; base: string }) {
  const period = query.period === "week" || query.period === "custom" ? query.period : "month";
  return (
    <div className="stack">
      <form className="row no-print" action={base}>
        <input type="hidden" name="tab" value={base.includes("sales") ? "reports" : "reports"} />
        {base.includes("money") ? <input type="hidden" name="id" value={kind} /> : null}
        <label className="field">Period
          <select name="period" defaultValue={period}>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="field">Date<input type="date" name="anchor" defaultValue={query.anchor || "2026-10-15"} /></label>
        <label className="field">From<input type="date" name="from" defaultValue={query.from || "2026-10-01"} /></label>
        <label className="field">To<input type="date" name="to" defaultValue={query.to || "2026-10-31"} /></label>
        <button className="btn secondary" type="submit">Update</button>
        <a className="btn secondary" href={`/api/reports/products.csv?period=${period}&anchor=${query.anchor || "2026-10-15"}`}>Product CSV</a>
        <a className="btn secondary" href={`/api/reports/profit.pdf?period=${period}&anchor=${query.anchor || "2026-10-15"}`}>P&amp;L PDF</a>
      </form>
      {kind === "profit" ? null : <p className="muted">Example data. These are not real sales or costs.</p>}
      {kind === "sales" ? <Sales kindQuery={query} /> : null}
      {kind === "products" ? <Products kindQuery={query} /> : null}
      {kind === "customers" ? <Customers kindQuery={query} /> : null}
      {kind === "mrp" ? <Mrp /> : null}
      {kind === "profit" ? <Profit kindQuery={query} /> : null}
      {kind === "balance" ? <Balance /> : null}
      {kind === "ar" ? <Aging /> : null}
      <p className="muted no-print">Also: <Link href={`${base}${base.includes("?") ? "&" : "?"}id=products`}>By product</Link> · <Link href={`${base.includes("sales") ? "/money?tab=reports&id=customers" : base + "&id=customers"}`}>By customer</Link> · <Link href="/money?tab=reports&id=mrp">MRP</Link> · <Link href="/money?tab=reports&id=profit">P&amp;L</Link> · <Link href="/money?tab=reports&id=balance">Balance sheet</Link> · <Link href="/money?tab=reports&id=ar">AR aging</Link></p>
    </div>
  );
}

async function Sales({ kindQuery }: { kindQuery: ReportQuery }) {
  const report = await salesReport(kindQuery);
  const total = report.rows.reduce((sum, row) => sum + row.currentCents, 0);
  const prior = report.rows.reduce((sum, row) => sum + row.priorCents, 0);
  return (
    <>
      <h2>{report.window.label}</h2>
      <p>{report.invoiceCount} invoices. This period {usd(total)}. Prior period {usd(prior)}.</p>
      <div className="wrap"><table>
        <thead><tr><th>Channel</th><th className="num">This period</th><th className="num">Prior period</th><th className="num">Change</th></tr></thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.name}><td>{row.name}</td><td className="num">{usd(row.currentCents)}</td><td className="num">{usd(row.priorCents)}</td><td className="num">{usd(row.deltaCents)}</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

async function Products({ kindQuery }: { kindQuery: ReportQuery }) {
  const report = await productReport(kindQuery);
  return (
    <>
      <h2>Sales by product · {report.window.label}</h2>
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Revenue</th><th className="num">COGS</th><th className="num">Margin</th><th className="num">Margin %</th></tr></thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.id}><td>{row.name}</td><td className="num">{row.qty}</td><td className="num">{usd(row.revenueCents)}</td><td className="num">{usd(row.cogsCents)}</td><td className="num">{usd(row.marginCents)}</td><td className="num">{row.marginPercent == null ? "—" : `${row.marginPercent}%`}</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

async function Customers({ kindQuery }: { kindQuery: ReportQuery }) {
  const report = await customerReport(kindQuery);
  return (
    <>
      <h2>Sales by customer · {report.window.label}</h2>
      <div className="wrap"><table>
        <thead><tr><th>Customer</th><th className="num">Revenue</th><th className="num">Margin</th><th className="num">Invoices</th><th className="num">Still open</th></tr></thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.name}><td>{row.name}</td><td className="num">{usd(row.revenueCents)}</td><td className="num">{usd(row.marginCents)}</td><td className="num">{row.invoices}</td><td className="num">{usd(row.arCents)}</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

async function Mrp() {
  const rows = await mrpReport();
  const buying = rows.filter((row) => row.tone !== "ok");
  return (
    <>
      <h2>What to buy</h2>
      <p>Packaging follows the bill of materials. A gallon uses its bottle, cap, and label. A pallet shipment uses the pallet and the wrap.</p>
      <div className="wrap"><table>
        <thead><tr><th>Item</th><th className="num">On hand</th><th className="num">A week</th><th className="num">Weeks left</th><th>Runs out</th><th className="num">Buy</th></tr></thead>
        <tbody>
          {buying.map((row) => (
            <tr key={row.productId}><td>{row.sku} {row.name}</td><td className="num">{row.onHand}</td><td className="num">{row.weeklyUse}</td><td className="num">{row.weeksLeft ?? "—"}</td><td><span className={`chip ${row.tone === "red" ? "bad" : "warn"}`}>{row.runOut}</span></td><td className="num">{row.suggestedQty}</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

async function Profit({ kindQuery }: { kindQuery: ReportQuery }) {
  const report = await profitReport(kindQuery);
  return <ProfitStatement rows={report.rows} from={report.window.from} to={report.window.to} priorFrom={report.window.priorFrom} />;
}

async function Balance() {
  const report = await balanceReport("2026-10-31");
  return (
    <>
      <h2>Balance sheet · {report.asOf}</h2>
      <p>{report.sheet.balanced ? "The sheet balances." : "The sheet does not balance."}</p>
      <Sheet title="What we own" rows={report.sheet.assets.rows} total={report.sheet.assets.totalCents} />
      <Sheet title="What we owe" rows={report.sheet.liabilities.rows} total={report.sheet.liabilities.totalCents} />
      <Sheet title="Equity" rows={[...report.sheet.equity.rows, { accountCode: "", name: "Earnings so far", cents: report.sheet.earningsCents }]} total={report.sheet.rightSideCents - report.sheet.liabilities.totalCents} />
    </>
  );
}

function Sheet({ title, rows, total }: { title: string; rows: { accountCode: string; name: string; cents: number }[]; total: number }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="wrap"><table>
        <tbody>
          {rows.map((row) => <tr key={row.accountCode + row.name}><td>{row.accountCode} {row.name}</td><td className="num">{usd(row.cents)}</td></tr>)}
          <tr><td><strong>Total</strong></td><td className="num"><strong>{usd(total)}</strong></td></tr>
        </tbody>
      </table></div>
    </>
  );
}

async function Aging() {
  const report = await agingReport();
  return (
    <>
      <h2>Who owes us · {report.asOf}</h2>
      <div className="kpis">
        {report.summary.buckets && Object.entries(AGING_LABEL).map(([key, label]) => (
          <div className="card" key={key}><span>{label}</span><strong>{usd((report.summary.buckets as Record<string, number>)[key] ?? 0)}</strong></div>
        ))}
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th className="num">Open</th></tr></thead>
        <tbody>
          {report.invoices.map((row) => <tr key={row.number}><td>{row.number}</td><td>{row.name}</td><td>{row.due}</td><td className="num">{usd(row.balanceCents)}</td></tr>)}
        </tbody>
      </table></div>
    </>
  );
}
