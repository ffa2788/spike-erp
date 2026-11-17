import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { DrawerClose, Screen, one } from "@/components/screen";
import { prisma } from "@/lib/db";
import { formatDate, usd } from "@/lib/format";
import { INVOICE_LABEL, PO_LABEL } from "@/lib/labels";
import VendorsPage from "../vendors/page";
import VendorPage from "../vendors/[id]/page";
import NewVendorPage from "../vendors/new/page";
import PoPage from "./orders/[id]/page";
import NewPoPage from "./orders/new/page";
import ReceiptPage from "./receipts/[id]/page";
import BillPage from "./bills/[id]/page";

export const dynamic = "force-dynamic";

const TABS = [
  ["orders", "Purchase orders"],
  ["receipts", "Receiving"],
  ["bills", "Bills"],
  ["suppliers", "Suppliers"],
] as const;

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = await readQuery(Promise.resolve(sp));
  const again = Promise.resolve(sp);
  const tab = TABS.some(([id]) => id === one(sp, "tab")) ? one(sp, "tab") : "orders";
  const id = one(sp, "id");
  const isNew = one(sp, "new") === "1";
  const [orders, bills, receipts] = await Promise.all([
    prisma.purchaseOrder.findMany({ include: { party: true, lines: true }, orderBy: { orderedOn: "desc" } }),
    prisma.vendorBill.findMany({ include: { party: true }, orderBy: { billedOn: "desc" } }),
    prisma.receipt.findMany({ include: { order: { include: { party: true } } }, orderBy: { receivedOn: "desc" } }),
  ]);
  const drawer = tab === "orders" && isNew
    ? <NewPoPage searchParams={again} />
    : tab === "orders" && id
      ? <PoPage params={Promise.resolve({ id })} searchParams={again} />
      : tab === "receipts" && id
        ? <ReceiptPage params={Promise.resolve({ id })} searchParams={again} />
        : tab === "bills" && id
          ? <BillPage params={Promise.resolve({ id })} searchParams={again} />
          : tab === "suppliers" && isNew
            ? <NewVendorPage searchParams={again} />
            : tab === "suppliers" && id
              ? <VendorPage params={Promise.resolve({ id })} searchParams={again} />
              : null;
  return (
    <Screen
      title="Purchasing"
      lede="Order, receive into the warehouse, then enter the supplier bill."
      primary={{ href: "/purchasing?tab=orders&new=1", label: "New purchase order" }}
      active={tab}
      tabs={TABS.map(([tabId, label]) => ({ id: tabId, label, href: `/purchasing?tab=${tabId}` }))}
      drawer={drawer ? <><DrawerClose href={`/purchasing?tab=${tab}`} />{drawer}</> : undefined}
    >
      <Flash error={query.error} notice={query.notice} />
      {tab === "orders" && (
        <div className="wrap"><table>
          <thead><tr><th>Number</th><th>Supplier</th><th>Date</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td><Link href={`/purchasing?tab=orders&id=${order.id}`}>{order.number}</Link></td>
                <td>{order.party.name}</td>
                <td>{formatDate(order.orderedOn)}</td>
                <td className="num">{usd(order.lines.reduce((sum, line) => sum + Math.round(Number(line.qty) * line.unitPriceCents), 0))}</td>
                <td><span className="chip">{PO_LABEL[order.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {tab === "receipts" && (
        <div className="wrap"><table>
          <thead><tr><th>Number</th><th>Supplier</th><th>Received</th></tr></thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td><Link href={`/purchasing?tab=receipts&id=${receipt.id}`}>{receipt.number}</Link></td>
                <td>{receipt.order.party.name}</td>
                <td>{formatDate(receipt.receivedOn)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {tab === "bills" && (
        <div className="wrap"><table>
          <thead><tr><th>Number</th><th>Supplier</th><th>Due</th><th className="num">Balance</th><th>Status</th></tr></thead>
          <tbody>
            {bills.map((bill) => (
              <tr key={bill.id}>
                <td><Link href={`/purchasing?tab=bills&id=${bill.id}`}>{bill.number}</Link></td>
                <td>{bill.party.name}</td>
                <td>{formatDate(bill.dueOn)}</td>
                <td className="num">{usd(bill.balanceCents)}</td>
                <td><span className="chip">{INVOICE_LABEL[bill.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {tab === "suppliers" && <VendorsPage searchParams={again} />}
    </Screen>
  );
}
