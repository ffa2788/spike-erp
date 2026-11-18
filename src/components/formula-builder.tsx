"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WATER_LB_PER_GALLON } from "@/lib/formula-math";
import { usdPrecise } from "@/lib/format";
import { savePoundsFormula } from "@/server/extra-actions";

type Ingredient = { id: string; name: string; costPerLb: number };
type ProductChoice = { id: string; name: string; sku: string };
type Row = { ingredientId: string; pounds: string };

export function FormulaBuilder({
  productId,
  productName,
  products,
  ingredients,
  initial,
  gravity,
  form,
  version,
}: {
  productId: string;
  productName: string;
  products: ProductChoice[];
  ingredients: Ingredient[];
  initial: Row[];
  gravity: number | null;
  form: "LIQUID" | "POWDER";
  version: number | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [density, setDensity] = useState(gravity && gravity > 0 ? String(gravity) : "");
  const [scale, setScale] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [notes, setNotes] = useState("");
  const byId = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients]);
  const totalLb = rows.reduce((sum, row) => sum + (Number(row.pounds) > 0 ? Number(row.pounds) : 0), 0);
  const batchCost = rows.reduce((sum, row) => {
    const pounds = Number(row.pounds);
    const cost = byId.get(row.ingredientId)?.costPerLb ?? 0;
    return sum + (pounds > 0 ? pounds * cost : 0);
  }, 0);
  const perLb = totalLb > 0 ? batchCost / totalLb : null;
  const sg = Number(density);
  const perGal = perLb != null && sg > 0 ? perLb * sg * WATER_LB_PER_GALLON : null;
  const matches = ingredients.filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return false;
    return item.name.toLowerCase().includes(needle) && !rows.some((row) => row.ingredientId === item.id);
  }).slice(0, 8);

  function add(id: string) {
    setRows((current) => [...current, { ingredientId: id, pounds: "" }]);
    setQuery("");
    setOpen(false);
  }

  function applyScale() {
    const amount = Number(scale);
    if (!(amount > 0) || !(totalLb > 0)) return;
    const target = form === "LIQUID" ? (sg > 0 ? amount * sg * WATER_LB_PER_GALLON : 0) : amount;
    if (!(target > 0)) return;
    const factor = target / totalLb;
    setRows((current) => current.map((row) => ({
      ...row,
      pounds: Number(row.pounds) > 0 ? String(Math.round(Number(row.pounds) * factor * 1000) / 1000) : row.pounds,
    })));
  }

  const saved = rows.filter((row) => row.ingredientId && Number(row.pounds) > 0);

  return (
    <div>
      <label className="field">Product
        <select value={productId} onChange={(event) => router.push(`/products?formula=1&id=${event.target.value}`)}>
          {products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
        </select>
      </label>
      <p className="lede">{productName}{version ? ` · version ${version}` : ""}. Enter pounds. Percents and cost update as you type. Save stores the next version.</p>
      <div className="formula">
        <form action={savePoundsFormula}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="specificGravity" value={density} />
          <input type="hidden" name="notes" value={notes} />
          {saved.map((row) => (
            <span key={row.ingredientId}>
              <input type="hidden" name="ingredientId" value={row.ingredientId} />
              <input type="hidden" name="pounds" value={row.pounds} />
            </span>
          ))}
          <div className="row">
            <label className="field" style={{ margin: 0 }}>Make
              <input value={scale} onChange={(event) => setScale(event.target.value)} inputMode="decimal" placeholder={form === "LIQUID" ? "gallons" : "pounds"} />
            </label>
            <button className="btn secondary" type="button" onClick={applyScale}>Scale to {form === "LIQUID" ? "gallons" : "pounds"}</button>
          </div>
          <div className="suggest">
            <label className="field">Add an ingredient
              <input value={query} placeholder="Search by name" onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
            </label>
            {open && matches.length > 0 ? (
              <div className="suggest-list">
                {matches.map((item) => (
                  <button key={item.id} type="button" onClick={() => add(item.id)}>{item.name}</button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="wrap">
            <table>
              <thead><tr><th>Ingredient</th><th className="num">Pounds</th><th className="num">Percent</th><th className="num">Cost</th><th></th></tr></thead>
              <tbody>
                {rows.map((row, index) => {
                  const pounds = Number(row.pounds) > 0 ? Number(row.pounds) : 0;
                  const percent = totalLb > 0 ? (pounds / totalLb) * 100 : 0;
                  const lineCost = pounds * (byId.get(row.ingredientId)?.costPerLb ?? 0);
                  return (
                    <tr key={row.ingredientId}>
                      <td>{byId.get(row.ingredientId)?.name ?? "Ingredient"}</td>
                      <td className="num"><input className="num" style={{ width: 110 }} inputMode="decimal" value={row.pounds} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, pounds: event.target.value } : item))} /></td>
                      <td className="num">{totalLb > 0 ? `${percent.toFixed(1)}%` : "—"}</td>
                      <td className="num">{pounds > 0 ? usdPrecise(lineCost) : "—"}</td>
                      <td><button className="btn secondary" type="button" onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? <tr><td colSpan={5}>Search above and add the first ingredient.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {advanced ? (
            <label className="field" style={{ marginTop: 12 }}>Note for this version
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          ) : null}
          <div className="row">
            <button className="btn" type="submit">Save</button>
            <button className="btn secondary" type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced" : "Advanced"}</button>
          </div>
        </form>
        <aside className="card summary-card">
          <span>This batch</span>
          <div className="metric"><span>Weight</span><strong className="kpi">{totalLb > 0 ? `${totalLb.toLocaleString("en-US", { maximumFractionDigits: 2 })} lb` : "—"}</strong></div>
          <div className="metric"><span>Cost per lb</span><strong className="kpi">{perLb == null ? "—" : usdPrecise(perLb)}</strong></div>
          <div className="metric"><span>Cost per gallon</span><strong className="kpi">{perGal == null ? "—" : usdPrecise(perGal)}</strong></div>
          <div className="metric"><span>Batch total</span><strong className="kpi">{totalLb > 0 ? usdPrecise(batchCost) : "—"}</strong></div>
          <label className="field" style={{ marginTop: 14 }}>Specific gravity
            <input value={density} inputMode="decimal" placeholder="1.10" onChange={(event) => setDensity(event.target.value)} />
          </label>
          {form === "LIQUID" && !(sg > 0) ? <p className="muted">Enter specific gravity to show cost per gallon and to scale by gallons.</p> : null}
        </aside>
      </div>
    </div>
  );
}
