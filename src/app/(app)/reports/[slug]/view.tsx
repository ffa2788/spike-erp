import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatDate, formatQty, usd } from "@/lib/format";
import { AGING_LABEL, summarizeAging } from "@/lib/aging";
import { lotQty, valueCents } from "@/lib/inventory";
import { balanceSheet, profitAndLoss } from "@/lib/journals";
import { assessBooks, currentStock, postedLines } from "@/lib/read-models";
import { channelPrefix } from "@/lib/commercial";
import { buildSalesReport } from "@/lib/sales-report";

export const dynamic = "force-dynamic";

export async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const from = typeof query.from === "string" && query.from ? query.from : `${todayInput().slice(0, 4)}-01-01`;
  const to = typeof query.to === "string" && query.to ? query.to : todayInput();
  const channel = typeof query.channel === "string" ? query.channel : "ALL";
  const titles: Record<string, string> = {
    sales: "Sales",
    margins: "Margins",
    inventory: "Inventory valuation",
    ar: "Who owes us",
    ap: "Who we owe",
    profit: "Profit",
    balance: "Balance sheet",
  };
  if (!titles[slug]) notFound();
  return (
    <>
      <div className="row no-print">
        <h1>{titles[slug]}</h1>
        <PrintButton label="Print" />
        <Link href="/reports">All reports</Link>
      </div>
      {slug !== "inventory" && slug !== "ar" && slug !== "ap" && slug !== "balance" && (
        <form className="row no-print">
          <label className="field">From<input type="date" name="from" defaultValue={from} /></label>
          <label className="field">To<input type="date" name="to" defaultValue={to} /></label>
          {(slug === "sales" || slug === "margins") && (
            <label className="field">Channel
              <select name="channel" defaultValue={channel}>
                <option value="ALL">All channels</option>
                <option value="S">S — direct SPER</option>
                <option value="A">A — Amazon</option>
                <option value="W">W — Walmart FBM</option>
                <option value="E">E — Export</option>
              </select>
            </label>
          )}
          <button className="btn secondary" type="submit">Update</button>
        </form>
      )}
      {slug === "sales" || slug === "margins" ? <SalesBlock from={from} to={to} margins={slug === "margins"} channel={channel} /> : null}
      {slug === "inventory" ? <InventoryBlock /> : null}
      {slug === "ar" ? <AgingBlock kind="ar" /> : null}
      {slug === "ap" ? <AgingBlock kind="ap" /> : null}
      {slug === "profit" ? <ProfitBlock from={from} to={to} /> : null}
      {slug === "balance" ? <BalanceBlock /> : null}
    </>
  );
}

async function SalesBlock({ from, to, margins, channel }: { from: string; to: string; margins: boolean; channel: string }) {
  const invoices = await prisma.invoice.findMany({
    where: { issuedOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) }, status: { not: "VOID" } },
    include: { party: true, lines: true },
  });
  const filtered = channel === "ALL" ? invoices : invoices.filter((invoice) => channelPrefix(invoice.channel) === channel);
  const report = buildSalesReport(filtered.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    issuedOn: from,
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
  return (
    <>
      <p>{formatDate(from)} to {formatDate(to)}. {report.invoiceCount} invoices. Sales {usd(report.subtotalCents)}. Tax {usd(report.taxCents)}.</p>
      {margins && <p>Cost {usd(report.cogsCents)}. Margin {usd(report.marginCents)}. After Amazon fees {usd(report.marginAfterFeesCents)}.</p>}
      <h2>By customer</h2>
      <table>
        <thead><tr><th>Customer</th><th>Sales</th>{margins && <th>Margin</th>}</tr></thead>
        <tbody>{report.byCustomer.map((row) => <tr key={row.name}><td>{row.name}</td><td>{usd(row.amountCents)}</td>{margins && <td>{usd(row.marginCents)}</td>}</tr>)}</tbody>
      </table>
      <h2>By product</h2>
      <table>
        <thead><tr><th>Product</th><th>Quantity</th><th>Sales</th>{margins && <th>Margin</th>}</tr></thead>
        <tbody>{report.byProduct.map((row) => <tr key={row.id}><td>{row.name}</td><td>{formatQty(row.qty)}</td><td>{usd(row.amountCents)}</td>{margins && <td>{usd(row.marginCents)}</td>}</tr>)}</tbody>
      </table>
      <h2>By channel</h2>
      <table>
        <tbody>{report.byChannel.map((row) => <tr key={row.name}><td>{row.name}</td><td>{usd(row.amountCents)}</td></tr>)}</tbody>
      </table>
      <p>
        Amazon FBA {usd(filtered.filter((invoice) => invoice.channel === "AMAZON" && invoice.fulfillment === "FBA").reduce((sum, invoice) => sum + invoice.subtotalCents, 0))}
        {" · "}
        Amazon FBM {usd(filtered.filter((invoice) => invoice.channel === "AMAZON" && invoice.fulfillment === "FBM").reduce((sum, invoice) => sum + invoice.subtotalCents, 0))}.
        FBA quantity sits at Amazon. FBM quantity stays in the SPER warehouse until it ships. In-transit stock is its own location.
      </p>
    </>
  );
}

async function InventoryBlock() {
  const [stock, products, books] = await Promise.all([currentStock(), prisma.product.findMany(), assessBooks()]);
  const rows = stock.filter((lot) => lotQty(lot) > 0).map((lot) => ({
    ...lot,
    name: products.find((product) => product.id === lot.productId)?.name ?? "",
    unit: products.find((product) => product.id === lot.productId)?.unit ?? "",
    value: valueCents(lotQty(lot), lot.unitCost),
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <>
      <p>Lot value {usd(total)}. Inventory accounts {usd(books.inventoryGl)}. {total === books.inventoryGl ? "These match." : "These do not match. Stop and look before trusting either number."}</p>
      <table>
        <thead><tr><th>Lot</th><th>Product</th><th>Status</th><th>Quantity</th><th>Value</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.lotId}><td>{row.lotNumber}</td><td>{row.name}</td><td>{row.qcStatus}</td><td>{formatQty(lotQty(row), row.unit)}</td><td>{usd(row.value)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

async function AgingBlock({ kind }: { kind: "ar" | "ap" }) {
  const today = todayInput();
  const items = kind === "ar"
    ? (await prisma.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { party: true } })).map((row) => ({
        id: row.id, number: row.number, name: row.party.name, balanceCents: row.balanceCents, due: row.dueOn.toISOString().slice(0, 10),
      }))
    : (await prisma.vendorBill.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { party: true } })).map((row) => ({
        id: row.id, number: row.number, name: row.party.name, balanceCents: row.balanceCents, due: row.dueOn.toISOString().slice(0, 10),
      }));
  const summary = summarizeAging(items, today);
  return (
    <>
      <p>Open total {usd(summary.totalCents)} as of {formatDate(today)}.</p>
      <ul>{Object.entries(summary.buckets).map(([bucket, cents]) => <li key={bucket}>{AGING_LABEL[bucket as keyof typeof AGING_LABEL]}: {usd(cents)}</li>)}</ul>
      <table>
        <thead><tr><th>Name</th><th>Number</th><th>Days late</th><th>Balance</th></tr></thead>
        <tbody>{summary.rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.number}</td><td>{row.days}</td><td>{usd(row.balanceCents)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

async function ProfitBlock({ from, to }: { from: string; to: string }) {
  const lines = await postedLines();
  const report = profitAndLoss(lines, from, to);
  return (
    <>
      <p>{formatDate(from)} to {formatDate(to)}.</p>
      <h2>Income {usd(report.income.totalCents)}</h2>
      <ul>{report.income.rows.map((row) => <li key={row.accountCode}>{row.name}: {usd(row.cents)}</li>)}</ul>
      <h2>Cost {usd(report.cogs.totalCents)}</h2>
      <ul>{report.cogs.rows.map((row) => <li key={row.accountCode}>{row.name}: {usd(row.cents)}</li>)}</ul>
      <h2>Expenses {usd(report.expense.totalCents)}</h2>
      <ul>{report.expense.rows.map((row) => <li key={row.accountCode}>{row.name}: {usd(row.cents)}</li>)}</ul>
      <p><strong>Profit {usd(report.profitCents)}</strong></p>
    </>
  );
}

async function BalanceBlock() {
  const lines = await postedLines();
  const today = todayInput();
  const report = balanceSheet(lines, today);
  return (
    <>
      <p>As of {formatDate(today)}. {report.balanced ? "Assets equal liabilities, equity, and earnings." : "The balance sheet is out of balance."}</p>
      <h2>Assets {usd(report.assets.totalCents)}</h2>
      <ul>{report.assets.rows.map((row) => <li key={row.accountCode}>{row.name}: {usd(row.cents)}</li>)}</ul>
      <h2>Liabilities {usd(report.liabilities.totalCents)}</h2>
      <ul>{report.liabilities.rows.map((row) => <li key={row.accountCode}>{row.name}: {usd(row.cents)}</li>)}</ul>
      <h2>Equity {usd(report.equity.totalCents)}</h2>
      <ul>{report.equity.rows.map((row) => <li key={row.accountCode}>{row.name}: {usd(row.cents)}</li>)}</ul>
      <p>Earnings not closed to equity: {usd(report.earningsCents)}</p>
    </>
  );
}
