import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { buildPlan } from "@/lib/services/mrp-run";
import { convertPlanAction, saveForecast } from "@/server/planning-actions";

export const dynamic = "force-dynamic";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const plan = await buildPlan();
  const byId = new Map(plan.products.map((product) => [product.id, product]));
  const forecasts = await prisma.demandForecast.findMany({ include: { product: true }, orderBy: { weekOf: "asc" } });
  return (
    <>
      <h1>Planning</h1>
      <p className="lede">
        Demand is open sales orders plus a forecast. A forecast you type replaces the average of the last 12 weeks for that product, channel, and week.
        Channels are S for direct sales, A for Amazon, and W for Walmart. The plan explodes formulas, sub-recipes, and packaging, then nets released stock and open purchase orders.
        Quarantine is not available.
      </p>
      <Flash error={query.error} notice={query.notice} />
      <p>
        <Link className="btn secondary" href="/planning/coverage">Coverage</Link>{" "}
        <Link className="btn secondary" href="/planning/schedule">Suggested week for Trevor</Link>
      </p>
      <h2>Planned orders</h2>
      <form action={convertPlanAction}>
        <button className="btn" type="submit">Create the purchase orders and batches</button>
      </form>
      <div className="wrap"><table>
        <thead><tr><th>Item</th><th>Kind</th><th>Quantity</th><th>Order on</th><th>Due</th><th>Exception</th><th>Note</th></tr></thead>
        <tbody>
          {plan.plan.planned.map((row) => (
            <tr key={`${row.itemId}-${row.dueOn}-${row.kind}`}>
              <td>{byId.get(row.itemId)?.name}</td>
              <td>{row.kind === "PURCHASE" ? "Purchase" : "Production"}</td>
              <td>{formatQty(row.qty, byId.get(row.itemId)?.unit ?? "")}</td>
              <td>{row.orderOn}</td>
              <td>{row.dueOn}</td>
              <td>{row.exception === "NONE" ? "" : row.exception === "LATE" ? "Late" : "Expedite"}</td>
              <td>{row.note}</td>
            </tr>
          ))}
          {plan.plan.planned.length === 0 && <tr><td colSpan={7}>No purchases or batches are needed.</td></tr>}
        </tbody>
      </table></div>
      <h2>Exceptions</h2>
      <div className="wrap"><table>
        <thead><tr><th>Item</th><th>Exception</th><th>Quantity</th><th>Why</th></tr></thead>
        <tbody>
          {plan.plan.exceptions.map((row) => (
            <tr key={`${row.itemId}-${row.kind}`}>
              <td>{byId.get(row.itemId)?.name}</td>
              <td>{row.kind === "CANCEL" ? "Cancel" : row.kind === "LATE" ? "Late" : "Expedite"}</td>
              <td>{formatQty(row.qty, byId.get(row.itemId)?.unit ?? "")}</td>
              <td>{row.note}</td>
            </tr>
          ))}
          {plan.plan.exceptions.length === 0 && <tr><td colSpan={4}>No late, expedite, or cancel exceptions.</td></tr>}
        </tbody>
      </table></div>
      {plan.plan.error && <div className="banner bad">{plan.plan.error}</div>}
      <h2>Add a forecast</h2>
      <form action={saveForecast}>
        <label className="field">Product
          <select name="productId">{plan.products.filter((product) => product.sellable).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
        </label>
        <div className="grid-2">
          <label className="field">Channel
            <select name="channel"><option value="S">S — direct</option><option value="A">A — Amazon</option><option value="W">W — Walmart</option><option value="E">E — export</option></select>
          </label>
          <label className="field">Week of<input type="date" name="weekOf" required /></label>
          <label className="field">Quantity<input name="qty" required /></label>
        </div>
        <button className="btn" type="submit">Save the forecast</button>
      </form>
      {forecasts.length > 0 && (
        <ul>
          {forecasts.map((row) => <li key={row.id}>{row.product.name} · {row.channel} · {toDateInput(row.weekOf)} · {formatQty(Number(row.qty), row.product.unit)}</li>)}
        </ul>
      )}
    </>
  );
}
