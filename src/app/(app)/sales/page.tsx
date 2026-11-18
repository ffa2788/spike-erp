import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { DrawerClose, Screen, one } from "@/components/screen";
import { prisma } from "@/lib/db";
import { formatDate, usd } from "@/lib/format";
import { INVOICE_LABEL, ORDER_LABEL, QUOTE_LABEL } from "@/lib/labels";
import { CustomersPage } from "../customers/view";
import { CustomerPage } from "../customers/[id]/view";
import { NewCustomerPage } from "../customers/new/view";
import { QuotePage } from "./quotes/[id]/view";
import { NewQuotePage } from "./quotes/new/view";
import { OrderPage } from "./orders/[id]/view";
import { InvoicePage } from "./invoices/[id]/view";
import { DeliveryPage } from "./deliveries/[id]/view";
import { AmazonPage } from "./amazon/view";
import { AmazonImportPage } from "./amazon/import/view";
import { AmazonWeekPage } from "./amazon/week/view";
import { WalmartPage } from "./walmart/view";
import { OwnerReport } from "../reports/owner-view";

export const dynamic = "force-dynamic";

const TABS = [
  ["quotes", "Quotes"],
  ["orders", "Orders"],
  ["invoices", "Invoices"],
  ["shipments", "Shipments"],
  ["customers", "Customers"],
  ["amazon", "Amazon"],
  ["week", "Amazon week"],
  ["walmart", "Walmart"],
  ["reports", "Reports"],
] as const;

const FILTERS = [
  ["", "All"],
  ["DIRECT", "Direct"],
  ["FBA", "Amazon FBA"],
  ["FBM", "Amazon FBM"],
  ["WALMART", "Walmart"],
  ["EXPORT", "Export"],
] as const;

function matches(channel: string, fulfillment: string, filter: string) {
  if (!filter) return true;
  if (filter === "DIRECT") return channel === "DIRECT" || channel === "DISTRIBUTOR" || channel === "MUNICIPAL";
  if (filter === "FBA") return channel === "AMAZON" && (!fulfillment || fulfillment === "FBA");
  if (filter === "FBM") return channel === "AMAZON" && fulfillment !== "FBA";
  return channel === filter;
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = await readQuery(Promise.resolve(sp));
  const again = Promise.resolve(sp);
  const tab = TABS.some(([id]) => id === one(sp, "tab")) ? one(sp, "tab") : "quotes";
  const id = one(sp, "id");
  const isNew = one(sp, "new") === "1";
  const channel = one(sp, "channel");
  const close = `/sales?tab=${tab}${channel ? `&channel=${channel}` : ""}`;
  const [quotes, orders, invoices, deliveries] = await Promise.all([
    prisma.quote.findMany({ include: { party: true }, orderBy: { issuedOn: "desc" } }),
    prisma.salesOrder.findMany({ include: { party: true }, orderBy: { orderedOn: "desc" } }),
    prisma.invoice.findMany({ include: { party: true }, orderBy: { issuedOn: "desc" } }),
    prisma.delivery.findMany({ include: { order: { include: { party: true } }, invoice: true }, orderBy: { shippedOn: "desc" } }),
  ]);
  const primary = tab === "customers"
    ? { href: "/sales?tab=customers&new=1", label: "New customer" }
    : { href: "/sales?tab=quotes&new=1", label: "New quote" };
  let drawer = null;
  if (tab === "quotes" && isNew) drawer = <NewQuotePage searchParams={again} />;
  else if (tab === "quotes" && id) drawer = <QuotePage params={Promise.resolve({ id })} searchParams={again} />;
  else if (tab === "orders" && id) drawer = <OrderPage params={Promise.resolve({ id })} searchParams={again} />;
  else if (tab === "invoices" && id) drawer = <InvoicePage params={Promise.resolve({ id })} searchParams={again} />;
  else if (tab === "shipments" && id) drawer = <DeliveryPage params={Promise.resolve({ id })} searchParams={again} />;
  else if (tab === "customers" && isNew) drawer = <NewCustomerPage searchParams={again} />;
  else if (tab === "customers" && id) drawer = <CustomerPage params={Promise.resolve({ id })} searchParams={again} />;

  return (
    <Screen
      title="Sales"
      lede="Quotes, orders, invoices, and shipments. Numbers keep their S-, A-, W-, and E- prefixes."
      primary={primary}
      active={tab}
      tabs={TABS.map(([tabId, label]) => ({ id: tabId, label, href: `/sales?tab=${tabId}${channel ? `&channel=${channel}` : ""}` }))}
      filters={tab === "amazon" || tab === "walmart" ? null : (
        <div className="filters">
          {FILTERS.map(([value, label]) => (
            <Link key={value || "all"} href={`/sales?tab=${tab}${value ? `&channel=${value}` : ""}`} data-active={channel === value ? "true" : "false"}>{label}</Link>
          ))}
        </div>
      )}
      drawer={drawer ? <><DrawerClose href={close} />{drawer}</> : undefined}
    >
      <Flash error={query.error} notice={query.notice} />
      {tab === "quotes" && (
        <div className="wrap"><table>
          <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th className="num">Total</th><th>Status</th></tr></thead>
          <tbody>
            {quotes.filter((quote) => matches(quote.party.channel, "", channel)).map((quote) => (
              <tr key={quote.id}>
                <td><Link href={`/sales?tab=quotes&id=${quote.id}`}>{quote.number} rev {quote.revision}</Link></td>
                <td>{quote.party.name}</td>
                <td>{formatDate(quote.issuedOn)}</td>
                <td className="num">{usd(quote.totalCents)}</td>
                <td><span className="chip" data-status={quote.status}>{QUOTE_LABEL[quote.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {tab === "orders" && (
        <div className="wrap"><table>
          <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            {orders.filter((order) => matches(order.party.channel, "", channel)).map((order) => (
              <tr key={order.id}>
                <td><Link href={`/sales?tab=orders&id=${order.id}`}>{order.number}</Link></td>
                <td>{order.party.name}</td>
                <td>{formatDate(order.orderedOn)}</td>
                <td><span className="chip" data-status={order.status}>{ORDER_LABEL[order.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {tab === "invoices" && (
        <div className="wrap"><table>
          <thead><tr><th>Number</th><th>Customer</th><th>Due</th><th className="num">Balance</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.filter((invoice) => matches(invoice.channel, invoice.fulfillment, channel)).map((invoice) => (
              <tr key={invoice.id}>
                <td><Link href={`/sales?tab=invoices&id=${invoice.id}`}>{invoice.number}</Link></td>
                <td>{invoice.party.name}</td>
                <td>{formatDate(invoice.dueOn)}</td>
                <td className="num">{usd(invoice.balanceCents)}</td>
                <td><span className="chip" data-status={invoice.status}>{INVOICE_LABEL[invoice.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {tab === "shipments" && (
        <div className="wrap"><table>
          <thead><tr><th>Number</th><th>Customer</th><th>Shipped</th><th>Invoice</th></tr></thead>
          <tbody>
            {deliveries.filter((delivery) => matches(delivery.order.party.channel, "", channel)).map((delivery) => (
              <tr key={delivery.id}>
                <td><Link href={`/sales?tab=shipments&id=${delivery.id}`}>{delivery.number}</Link></td>
                <td>{delivery.order.party.name}</td>
                <td>{formatDate(delivery.shippedOn)}</td>
                <td>{delivery.invoice ? <Link href={`/sales?tab=invoices&id=${delivery.invoice.id}`}>{delivery.invoice.number}</Link> : "Not invoiced"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {tab === "customers" && <CustomersPage searchParams={again} />}
      {tab === "amazon" && <><AmazonPage searchParams={again} /><AmazonImportPage searchParams={again} /></>}
      {tab === "week" && <AmazonWeekPage searchParams={again} />}
      {tab === "walmart" && <WalmartPage searchParams={again} />}
      {tab === "reports" && (
        <OwnerReport
          kind={one(sp, "id") || "sales"}
          base="/sales"
          query={{ period: one(sp, "period"), anchor: one(sp, "anchor"), from: one(sp, "from"), to: one(sp, "to"), sort: one(sp, "sort") }}
        />
      )}
    </Screen>
  );
}
