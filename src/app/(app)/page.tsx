import Link from "next/link";
import { Flash } from "@/components/ui";
import { buildAttention } from "@/lib/attention";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { usd, formatDate, formatQty } from "@/lib/format";
import { rollUpCost } from "@/lib/costing";
import { lotQty, stockBuckets } from "@/lib/inventory";
import { reorderSuggestion } from "@/lib/planning";
import { buildPlan } from "@/lib/services/mrp-run";
import { assessBooks, currentStock } from "@/lib/read-models";
import { buildSalesReport } from "@/lib/sales-report";
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
  const monthStart = `${today.slice(0, 8)}01`;
  const [books, stock, bank, products, formulas, invoices, bills, orders, deliveries, quotes, parties] = await Promise.all([
    assessBooks(),
    currentStock(),
    bankPosition(),
    prisma.product.findMany({ where: { active: true } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } }),
    prisma.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { party: true } }),
    prisma.vendorBill.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { party: true } }),
    prisma.salesOrder.findMany({ where: { status: { in: ["CONFIRMED", "PARTLY_SHIPPED"] } }, include: { party: true } }),
    prisma.delivery.findMany({ where: { invoice: null } }),
    prisma.quote.findMany({ where: { status: "DRAFT" }, include: { party: true } }),
    prisma.party.findMany({ where: { taxExempt: true, exemptionExpires: { not: null } } }),
  ]);
  const monthInvoices = await prisma.invoice.findMany({
    where: { issuedOn: { gte: new Date(`${monthStart}T00:00:00Z`), lte: new Date(`${today}T23:59:59Z`) } },
    include: { lines: true, party: true },
  });
  const materialPlan = await buildPlan(today);
  const critical = materialPlan.coverage.filter((row) => row.status === "CRITICAL").length;
  const low = materialPlan.coverage.filter((row) => row.status === "LOW").length;
  const sales = buildSalesReport(monthInvoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    issuedOn: today,
    partyName: invoice.party.name,
    channel: invoice.channel,
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    feeCents: invoice.feeCents,
    lines: invoice.lines.map((line) => ({
      productId: line.productId,
      productName: line.description,
      qty: Number(line.qty),
      amountCents: Math.round(Number(line.qty) * line.unitPriceCents),
      cogsCents: line.cogsCents,
    })),
  })));
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
    draftQuotes: quotes.map((quote) => ({ id: quote.id, number: quote.number, name: quote.party.name })),
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
      <p className="lede">{formatDate(new Date())}. Do the red and amber items first. The numbers below come from the same records as the reports.</p>
      <Flash error={query.error} notice={query.notice} />
      {!books.check.ok && (
        <div className="banner bad">Stop. {books.check.problems[0]}</div>
      )}
      <div className="cards">
        <div className="card"><span>Cash in the bank</span><strong>{usd(books.cashCents)}</strong></div>
        <div className="card"><span>Customers owe us</span><strong>{usd(books.arSub)}</strong></div>
        <div className="card"><span>We owe suppliers</span><strong>{usd(books.apSub)}</strong></div>
        <div className="card"><span>Inventory</span><strong>{usd(books.inventoryLots)}</strong></div>
        <div className="card"><span>Sales this month</span><strong>{usd(sales.subtotalCents)}</strong></div>
        <div className="card"><span>Margin this month</span><strong>{usd(sales.marginCents)}</strong></div>
        <Link className="card" href="/planning/coverage"><span>Coverage</span><strong>{critical} critical, {low} low</strong></Link>
      </div>
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
        <Link className="btn secondary" href="/money/reconcile">Check the bank</Link>
        <Link className="btn secondary" href="/inventory">Print a label</Link>
      </div>
      <p className="muted">Sales this month are product sales before tax. Margin is those sales minus the cost recorded on the same invoices.</p>
      <p className="muted">{formatQty(stock.reduce((sum, lot) => sum + lotQty(lot), 0))} on hand across all lots, including lots waiting for quality.</p>
    </>
  );
}
