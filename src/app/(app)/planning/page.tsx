import Link from "next/link";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { stockBuckets } from "@/lib/inventory";
import { reorderSuggestion } from "@/lib/planning";
import { currentStock } from "@/lib/read-models";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const today = todayInput();
  const [products, stock, orderLines, poLines] = await Promise.all([
    prisma.product.findMany({ where: { trackInventory: true, active: true }, include: { preferredVendor: true }, orderBy: { name: "asc" } }),
    currentStock(),
    prisma.salesOrderLine.findMany({
      where: { order: { status: { in: ["CONFIRMED", "PARTLY_SHIPPED"] } } },
      include: { deliveryLines: true },
    }),
    prisma.purchaseOrderLine.findMany({
      where: { order: { status: { in: ["SENT", "PARTLY_RECEIVED"] } } },
    }),
  ]);
  const openSales = new Map<string, number>();
  for (const line of orderLines) {
    const shipped = line.deliveryLines.reduce((sum, item) => sum + Number(item.qty), 0);
    openSales.set(line.productId, (openSales.get(line.productId) ?? 0) + Math.max(0, Number(line.qty) - shipped));
  }
  const openPo = new Map<string, number>();
  for (const line of poLines) {
    openPo.set(line.productId, (openPo.get(line.productId) ?? 0) + Math.max(0, Number(line.qty) - Number(line.qtyReceived)));
  }
  return (
    <>
      <h1>Planning</h1>
      <p className="lede">Demand is open sales orders. Stock is released and not expired. Open purchase orders count as incoming. Quarantine does not.</p>
      <div className="wrap"><table>
        <thead><tr><th>Product</th><th>Open orders</th><th>Ready</th><th>On order</th><th>Waiting on quality</th><th>What to do</th></tr></thead>
        <tbody>
          {products.map((product) => {
            const buckets = stockBuckets(stock, product.id, today);
            const suggestion = reorderSuggestion({
              minQty: Number(product.minQty),
              openSalesQty: openSales.get(product.id) ?? 0,
              availableQty: buckets.available,
              openPoQty: openPo.get(product.id) ?? 0,
              unit: product.unit,
            });
            return (
              <tr key={product.id}>
                <td><Link href={`/products/${product.id}`}>{product.name}</Link>{product.preferredVendor ? ` · ${product.preferredVendor.name}` : ""}</td>
                <td>{formatQty(openSales.get(product.id) ?? 0, product.unit)}</td>
                <td>{formatQty(buckets.available, product.unit)}</td>
                <td>{formatQty(openPo.get(product.id) ?? 0, product.unit)}</td>
                <td>{formatQty(buckets.quarantine, product.unit)}</td>
                <td>{suggestion.words}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}
