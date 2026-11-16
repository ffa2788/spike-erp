import Link from "next/link";
import { Flash } from "@/components/ui";
import { buildAttention } from "@/lib/attention";
import { prisma } from "@/lib/db";
import { toDateInput, todayInput } from "@/lib/dates";
import { usd, formatDate, formatQty } from "@/lib/format";
import { rollUpCost } from "@/lib/costing";
import { lotQty, stockBuckets } from "@/lib/inventory";
import { reorderSuggestion } from "@/lib/planning";
import { buildPlan } from "@/lib/services/mrp-run";
import { assessBooks, currentStock } from "@/lib/read-models";
import { executiveDashboard } from "@/lib/dashboard";
import { bankPosition } from "@/lib/services/money";
import { readQuery } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const today = todayInput();
  const employeeCount = await prisma.employee.count({ where: { active: true } });
  const [books, stock, bank, products, formulas, invoices, salesInvoices, bills, orders, deliveries, quotes, company, parties] = await Promise.all([
    assessBooks(),
    currentStock(),
    bankPosition(),
    prisma.product.findMany({ where: { active: true } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } }),
    prisma.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { party: true } }),
    prisma.invoice.findMany({
      where: { status: { not: "VOID" }, issuedOn: { gte: new Date(`${Number(today.slice(0, 4)) - 1}-01-01T00:00:00Z`) } },
      include: { lines: true, party: true },
    }),
    prisma.vendorBill.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { party: true } }),
    prisma.salesOrder.findMany({ where: { status: { in: ["CONFIRMED", "PARTLY_SHIPPED"] } }, include: { party: true } }),
    prisma.delivery.findMany({ where: { invoice: null } }),
    prisma.quote.findMany({ where: { status: { in: ["DRAFT", "SENT"] } }, include: { party: true } }),
    prisma.companyProfile.findUnique({ where: { id: "company" } }),
    prisma.party.findMany({ where: { taxExempt: true, exemptionExpires: { not: null } } }),
  ]);
  const materialPlan = await buildPlan(today);
  const critical = materialPlan.coverage.filter((row) => row.status === "CRITICAL").length;
  const low = materialPlan.coverage.filter((row) => row.status === "LOW").length;
  const belowReorder = products.filter((product) => {
    if (!product.trackInventory || Number(product.minQty) <= 0) return false;
    return stockBuckets(stock, product.id, today).available < Number(product.minQty);
  }).length;
  const dash = executiveDashboard({
    asOf: today,
    entity: company?.entityType === "C_CORP" ? "C_CORP" : "S_CORP",
    invoices: salesInvoices.map((invoice) => ({
      issuedOn: toDateInput(invoice.issuedOn),
      channel: invoice.channel,
      partyName: invoice.party.name,
      subtotalCents: invoice.subtotalCents,
      lines: invoice.lines.map((line) => ({
        productId: line.productId,
        productName: line.description,
        amountCents: Math.round(Number(line.qty) * line.unitPriceCents),
        cogsCents: line.cogsCents,
      })),
    })),
    quotes: quotes.map((quote) => ({ status: quote.status, totalCents: quote.totalCents })),
    receivables: invoices.map((invoice) => ({ balanceCents: invoice.balanceCents, due: toDateInput(invoice.dueOn) })),
    payables: bills.map((bill) => ({ balanceCents: bill.balanceCents, due: toDateInput(bill.dueOn) })),
    cashCents: books.cashCents,
    unreconciled: bank.openStatement,
    inventoryCents: books.inventoryLots,
    belowReorder,
    criticalCoverage: critical,
    lowCoverage: low,
    ordersToShip: orders.length,
    uninvoicedDeliveries: deliveries.length,
  });
  const costProducts = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    kind: product.kind,
    standardCost: Number(product.standardCost),
  }));
  const costFormulas = formulas.map((formula) => ({
    productId: formula.productId,
    isDefault: true,
    lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
  }));
  const orderLines = await prisma.salesOrderLine.findMany({
    where: { order: { status: { in: ["CONFIRMED", "PARTLY_SHIPPED"] } } },
    include: { deliveryLines: true },
  });
  const poLines = await prisma.purchaseOrderLine.findMany({
    where: { order: { status: { in: ["SENT", "PARTLY_RECEIVED"] } } },
  });
  const openSales = new Map<string, number>();
  for (const line of orderLines) {
    const shipped = line.deliveryLines.reduce((sum, item) => sum + Number(item.qty), 0);
    openSales.set(line.productId, (openSales.get(line.productId) ?? 0) + Math.max(0, Number(line.qty) - shipped));
  }
  const openPo = new Map<string, number>();
  for (const line of poLines) {
    openPo.set(line.productId, (openPo.get(line.productId) ?? 0) + Math.max(0, Number(line.qty) - Number(line.qtyReceived)));
  }
  const buys = products.flatMap((product) => {
    if (!product.trackInventory) return [];
    const buckets = stockBuckets(stock, product.id, today);
    const suggestion = reorderSuggestion({
      minQty: Number(product.minQty),
      openSalesQty: openSales.get(product.id) ?? 0,
      availableQty: buckets.available,
      openPoQty: openPo.get(product.id) ?? 0,
      unit: product.unit,
    });
    if (suggestion.buyQty <= 0) return [];
    return [{ id: product.id, sku: product.sku, name: product.name, words: suggestion.words }];
  });
  const soon = (value: Date | null) => {
    if (!value) return false;
    const iso = value.toISOString().slice(0, 10);
    const days = (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
    return days >= 0 && days <= 45;
  };
  const attention = buildAttention({
    booksProblems: books.check.problems,
    overdueInvoices: invoices.filter((invoice) => invoice.dueOn.toISOString().slice(0, 10) < today).map((invoice) => ({
      id: invoice.id, number: invoice.number, name: invoice.party.name, balanceCents: invoice.balanceCents,
    })),
    overdueBills: bills.filter((bill) => bill.dueOn.toISOString().slice(0, 10) < today).map((bill) => ({
      id: bill.id, number: bill.number, name: bill.party.name, balanceCents: bill.balanceCents,
    })),
    quarantineLots: stock.filter((lot) => lot.qcStatus === "QUARANTINE" && lotQty(lot) > 0).map((lot) => ({
      id: lot.lotId,
      lotNumber: lot.lotNumber,
      productName: products.find((product) => product.id === lot.productId)?.name ?? "Product",
    })),
    ordersToShip: orders.map((order) => ({ id: order.id, number: order.number, name: order.party.name })),
    uninvoicedDeliveries: deliveries.map((delivery) => ({ id: delivery.id, number: delivery.number })),
    bankOpenCount: bank.openStatement,
    buys,
    draftQuotes: quotes.filter((quote) => quote.status === "DRAFT").map((quote) => ({ id: quote.id, number: quote.number, name: quote.party.name })),
    expiringCertificates: parties.filter((party) => soon(party.exemptionExpires)).map((party) => ({
      id: party.id, name: party.name, expires: formatDate(party.exemptionExpires),
    })),
    expiringNsf: products.filter((product) => product.nsfCertified && soon(product.nsfExpiresOn)).map((product) => ({
      id: product.id, name: product.name, expires: formatDate(product.nsfExpiresOn),
    })),
    incompleteProducts: products.filter((product) => product.kind === "FINISHED").flatMap((product) => {
      const rolled = rollUpCost(product.id, costProducts, costFormulas);
      if (rolled.status === "OK" || rolled.status === "NO_FORMULA") return [];
      return [{ id: product.id, name: product.name, sku: product.sku }];
    }),
    usd,
  });
  return (
    <>
      <h1>Today at SPER</h1>
      <p className="lede">{formatDate(new Date())}. FFA and Chris both see the whole operation. Do the red and amber items first.</p>
      <Flash error={query.error} notice={query.notice} />
      {!books.check.ok && (
        <div className="banner bad">Stop. {books.check.problems[0]}</div>
      )}
      <div className="cards">
        <Link className="card" href="/reports/sales"><span>Sales this month</span><strong>{usd(dash.mtd.salesCents)}</strong><p className="muted">{dash.mtd.versus.words}</p></Link>
        <Link className="card" href="/reports/sales"><span>Sales this year</span><strong>{usd(dash.ytd.salesCents)}</strong><p className="muted">{dash.ytd.versus.words}</p></Link>
        <Link className="card" href="/reports/margins"><span>Gross margin</span><strong>{dash.marginPercent == null ? "—" : `${dash.marginPercent}%`}</strong><p className="muted">Sales minus the full cost on those invoices.</p></Link>
        {dash.channels.map((channel) => (
          <Link key={channel.code} className="card" href={`/reports/sales?channel=${channel.code}`}>
            <span>{channel.code} — {channel.label}</span>
            <strong>{usd(channel.salesCents)}</strong>
            <p className="muted">{channel.marginPercent == null ? "No sales" : `${channel.marginPercent}% margin`}</p>
          </Link>
        ))}
        <Link className="card" href="/sales"><span>Open quotes</span><strong>{dash.quoteCount}</strong><p className="muted">Pipeline {usd(dash.pipelineCents)}</p></Link>
        <Link className="card" href="/reports/ar"><span>Overdue from customers</span><strong>{usd(dash.overdueCents)}</strong><p className="muted">They owe {usd(dash.receivableCents)} in total.</p></Link>
        <Link className="card" href="/reports/ap"><span>Bills due in 14 days</span><strong>{usd(dash.payablesSoonCents)}</strong><p className="muted">{dash.payablesSoonCount} bill{dash.payablesSoonCount === 1 ? "" : "s"}, including any already late.</p></Link>
        <Link className="card" href="/money"><span>Cash in the bank</span><strong>{usd(dash.cashCents)}</strong></Link>
        <Link className="card" href="/money/reconcile"><span>Unreconciled bank lines</span><strong>{dash.unreconciled}</strong></Link>
        <Link className="card" href="/inventory"><span>Inventory</span><strong>{usd(dash.inventoryCents)}</strong><p className="muted">{dash.belowReorder} below the reorder point.</p></Link>
        <Link className="card" href="/planning/coverage"><span>Low coverage</span><strong>{dash.criticalCoverage} critical, {dash.lowCoverage} low</strong><p className="muted">Days of cover from the materials plan.</p></Link>
        <Link className="card" href="/sales"><span>Waiting to ship</span><strong>{dash.ordersToShip}</strong><p className="muted">{dash.uninvoicedDeliveries} shipment{dash.uninvoicedDeliveries === 1 ? "" : "s"} not invoiced yet.</p></Link>
        <Link className="card" href="/tax"><span>Next tax date</span><strong>{dash.taxDeadlines[0] ? formatDate(dash.taxDeadlines[0].date) : "None"}</strong><p className="muted">{dash.taxDeadlines[0]?.name}</p></Link>
        <Link className="card" href="/payroll"><span>Payroll</span><strong>{employeeCount} {employeeCount === 1 ? "person" : "people"}</strong><p className="muted">Florida. No state income tax. The accountant reviews the tax table.</p></Link>
      </div>
      <h2>Top products this year</h2>
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th>Sales</th><th>Margin</th></tr></thead>
        <tbody>
          {dash.topProducts.map((row) => (
            <tr key={row.name}><td><Link href="/reports/margins">{row.name}</Link></td><td>{usd(row.salesCents)}</td><td>{row.marginPercent == null ? "—" : `${row.marginPercent}%`}</td></tr>
          ))}
          {dash.topProducts.length === 0 && <tr><td colSpan={3}>No sales yet this year.</td></tr>}
        </tbody>
      </table></div>
      <h2>Top customers this year</h2>
      <div className="wrap"><table>
        <thead><tr><th>Customer</th><th>Sales</th><th>Margin</th></tr></thead>
        <tbody>
          {dash.topCustomers.map((row) => (
            <tr key={row.name}><td><Link href="/reports/sales">{row.name}</Link></td><td>{usd(row.salesCents)}</td><td>{row.marginPercent == null ? "—" : `${row.marginPercent}%`}</td></tr>
          ))}
          {dash.topCustomers.length === 0 && <tr><td colSpan={3}>No sales yet this year.</td></tr>}
        </tbody>
      </table></div>
      <h2>What needs attention</h2>
      {attention.length === 0 ? <p>Nothing is waiting on you today.</p> : (
        <div className="attention">
          {attention.map((item) => (
            <Link key={item.title} href={item.href}>
              <article className={`card ${item.tone}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </article>
            </Link>
          ))}
        </div>
      )}
      <h2>Start something</h2>
      <div className="row">
        <Link className="btn" href="/sales/quotes/new">New quote</Link>
        <Link className="btn" href="/purchasing/orders/new">New purchase order</Link>
        <Link className="btn secondary" href="/production/new">Plan a batch</Link>
        <Link className="btn secondary" href="/planning/schedule">Release to Trevor</Link>
        <Link className="btn secondary" href="/payroll">Payroll</Link>
      </div>
      <p className="muted">Sales are product sales before tax. Gross margin uses the cost recorded on those same invoices, including the recipe and packaging in that cost. Month and year are compared with the same dates last month and last year.</p>
      <p className="muted">{formatQty(stock.reduce((sum, lot) => sum + lotQty(lot), 0))} on hand across all lots, including lots waiting for quality.</p>
    </>
  );
}
