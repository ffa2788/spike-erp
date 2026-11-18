import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { DrawerClose, Screen, one } from "@/components/screen";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatDate, formatQty, usd } from "@/lib/format";
import { lotQty, stockBuckets, valueCents } from "@/lib/inventory";
import { currentStock } from "@/lib/read-models";
import { QC_LABEL } from "@/lib/labels";
import { LotPage } from "./[id]/view";
import { CoveragePage } from "../planning/coverage/view";
import { PlanningPage } from "../planning/view";
import { SchedulePage } from "../planning/schedule/view";
import { ProductionPage } from "../production/view";
import { NewBatchPage } from "../production/new/view";
import { BatchPage } from "../production/[id]/view";
import { loadBuySoon } from "@/lib/services/buy-soon";
import { createBuyPo, saveWeeklyUse } from "@/server/buy-soon-actions";

export const dynamic = "force-dynamic";

const TABS = [
  ["stock", "Stock"],
  ["coverage", "Coverage"],
  ["planning", "Materials plan"],
  ["schedule", "Production plan"],
  ["production", "Batches"],
  ["low", "Low stock"],
] as const;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = await readQuery(Promise.resolve(sp));
  const again = Promise.resolve(sp);
  const tab = TABS.some(([id]) => id === one(sp, "tab")) ? one(sp, "tab") : "stock";
  const id = one(sp, "id");
  const isNew = one(sp, "new") === "1";
  const today = todayInput();
  const [products, stock] = await Promise.all([
    prisma.product.findMany({ where: { trackInventory: true }, orderBy: { name: "asc" } }),
    currentStock(),
  ]);
  const needle = query.q.toLowerCase();
  const primary = tab === "production"
    ? { href: "/inventory?tab=production&new=1", label: "Plan a batch" }
    : undefined;
  const drawer = tab === "stock" && id
    ? <LotPage params={Promise.resolve({ id })} searchParams={again} />
    : tab === "production" && isNew
      ? <NewBatchPage searchParams={again} />
      : tab === "production" && id
        ? <BatchPage params={Promise.resolve({ id })} searchParams={again} />
        : null;
  return (
    <Screen
      title="Inventory and planning"
      lede="Stock, coverage, the materials plan, and the week Trevor will make."
      primary={primary}
      active={tab}
      tabs={TABS.map(([tabId, label]) => ({ id: tabId, label, href: `/inventory?tab=${tabId}` }))}
      drawer={drawer ? <><DrawerClose href={`/inventory?tab=${tab}`} />{drawer}</> : undefined}
    >
      {tab === "stock" && (
        <>
          <Flash error={query.error} notice={query.notice} />
          <form>
            <label className="field">Search<input name="q" defaultValue={query.q} /></label>
            <button className="btn secondary" type="submit">Search</button>
          </form>
          <div className="wrap"><table>
            <thead><tr><th>Product</th><th className="num">Ready</th><th className="num">Waiting</th><th className="num">Value</th></tr></thead>
            <tbody>
              {products.filter((product) => !needle || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle)).map((product) => {
                const buckets = stockBuckets(stock, product.id, today);
                return (
                  <tr key={product.id}>
                    <td><Link href={`/products?id=${product.id}`}>{product.sku}</Link> {product.name}</td>
                    <td className="num">{formatQty(buckets.available, product.unit)}</td>
                    <td className="num">{formatQty(buckets.quarantine, product.unit)}</td>
                    <td className="num">{usd(buckets.valueCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <h2>Lots</h2>
          <div className="wrap"><table>
            <thead><tr><th>Lot</th><th>Product</th><th>Status</th><th className="num">On hand</th><th className="num">Value</th></tr></thead>
            <tbody>
              {stock.filter((lot) => lotQty(lot) > 0).map((lot) => {
                const product = products.find((item) => item.id === lot.productId);
                return (
                  <tr key={lot.lotId}>
                    <td><Link href={`/inventory?tab=stock&id=${lot.lotId}`}>{lot.lotNumber}</Link></td>
                    <td>{product?.name}</td>
                    <td><span className={`chip ${lot.qcStatus === "QUARANTINE" ? "warn" : "good"}`}>{QC_LABEL[lot.qcStatus]}</span></td>
                    <td className="num">{formatQty(lotQty(lot), product?.unit)}</td>
                    <td className="num">{usd(valueCents(lotQty(lot), lot.unitCost))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </>
      )}
      {tab === "coverage" && <CoveragePage searchParams={again} />}
      {tab === "planning" && <PlanningPage searchParams={again} />}
      {tab === "schedule" && <SchedulePage searchParams={again} />}
      {tab === "production" && <ProductionPage searchParams={again} />}
      {tab === "low" && <LowStock />}
    </Screen>
  );
}

async function LowStock() {
  const rows = (await loadBuySoon()).filter((row) => row.tone !== "ok");
  return (
    <>
      <p className="lede">Cover is on hand plus what is already on order, divided by the average week from the last eight weeks. Red runs out before a purchase order could arrive.</p>
      {rows.length === 0 ? <div className="empty"><p>Nothing needs a purchase order from the last eight weeks of use.</p></div> : (
        <div className="wrap"><table>
          <thead>
            <tr><th>Item</th><th className="num">On hand</th><th className="num">A week</th><th className="num">Weeks left</th><th>Runs out</th><th className="num">Buy</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId}>
                <td>{row.sku}<br />{row.name}</td>
                <td className="num">{row.onHand} {row.unit}</td>
                <td className="num">{row.weeklyUse}</td>
                <td className="num">{row.weeksLeft ?? "—"}</td>
                <td><span className={`chip ${row.tone === "red" ? "bad" : "warn"}`}>{row.runOut ? formatDate(row.runOut) : "—"}</span></td>
                <td className="num">{row.suggestedQty}</td>
                <td>
                  <form action={createBuyPo}>
                    <input type="hidden" name="productId" value={row.productId} />
                    <input type="hidden" name="qty" value={row.suggestedQty} />
                    <button className="btn" type="submit">Create PO</button>
                  </form>
                  <form action={saveWeeklyUse} className="row">
                    <input type="hidden" name="productId" value={row.productId} />
                    <input name="weekly" placeholder="Weekly use" inputMode="decimal" />
                    <button className="btn secondary" type="submit">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
