import { buySoon, leadWeeks, packagingQty, type BuyTone, type PackBasisName } from "../buy-soon";
import { todayInput, toDateInput } from "../dates";
import { prisma } from "../db";
import { deliverEmail, emailSetup } from "../email";
import { lotQty } from "../inventory";
import { currentStock } from "../read-models";

const USE_REASONS = new Set(["PRODUCTION", "SHIPMENT", "FBA_SHIP", "ASSEMBLY"]);

export type BuyRow = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  onOrder: number;
  weeklyUse: number;
  weeksLeft: number | null;
  runOut: string | null;
  suggestedQty: number;
  tone: BuyTone;
  vendorId: string | null;
};

export async function loadBuySoon(asOf = todayInput()): Promise<BuyRow[]> {
  const start = new Date(`${asOf}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 56);
  const [products, movements, packs, invoices, stock, poLines] = await Promise.all([
    prisma.product.findMany({ where: { active: true, trackInventory: true } }),
    prisma.movement.findMany({ where: { at: { gte: start }, qty: { lt: 0 } } }),
    prisma.packRun.findMany({
      where: { packedOn: { gte: start } },
      include: { packagedSku: { include: { lines: true } } },
    }),
    prisma.invoiceLine.findMany({
      where: { invoice: { issuedOn: { gte: start }, status: { not: "VOID" }, channel: { in: ["AMAZON", "WALMART"] } } },
    }),
    currentStock(),
    prisma.purchaseOrderLine.findMany({
      where: { order: { status: { in: ["DRAFT", "SENT", "PARTLY_RECEIVED"] } } },
    }),
  ]);
  const packaged = await prisma.packagedSku.findMany({ include: { lines: true } });
  const byOutput = new Map(packaged.map((row) => [row.outputProductId, row]));
  const used = new Map<string, number>();
  const add = (id: string, qty: number) => used.set(id, (used.get(id) ?? 0) + qty);
  for (const move of movements) {
    if (!USE_REASONS.has(move.reason)) continue;
    add(move.productId, Math.abs(Number(move.qty)));
  }
  for (const run of packs) {
    const sku = run.packagedSku;
    for (const line of sku.lines) {
      const qty = packagingQty({
        units: run.units,
        unitsPerCase: sku.unitsPerCase,
        casesPerPallet: sku.casesPerPallet,
        basis: line.basis as PackBasisName,
        qty: Number(line.qty),
      });
      add(line.materialId, qty);
    }
  }
  for (const line of invoices) {
    const sku = byOutput.get(line.productId);
    if (!sku) continue;
    for (const part of sku.lines) {
      add(part.materialId, packagingQty({
        units: Number(line.qty),
        unitsPerCase: sku.unitsPerCase,
        casesPerPallet: sku.casesPerPallet,
        basis: part.basis as PackBasisName,
        qty: Number(part.qty),
      }));
    }
  }
  const onHand = new Map<string, number>();
  for (const lot of stock) {
    if (lot.qcStatus === "REJECTED") continue;
    onHand.set(lot.productId, (onHand.get(lot.productId) ?? 0) + lotQty(lot));
  }
  const onOrder = new Map<string, number>();
  for (const line of poLines) {
    onOrder.set(line.productId, (onOrder.get(line.productId) ?? 0) + Math.max(0, Number(line.qty) - Number(line.qtyReceived)));
  }
  const rows: BuyRow[] = [];
  for (const product of products) {
    const hand = onHand.get(product.id) ?? 0;
    const ordered = onOrder.get(product.id) ?? 0;
    const consumed = used.get(product.id) ?? 0;
    if (consumed <= 0 && product.weeklyUseOverride == null && hand <= 0) continue;
    const result = buySoon({
      onHand: hand,
      onOrder: ordered,
      usedIn8Weeks: consumed,
      weeklyOverride: product.weeklyUseOverride == null ? null : Number(product.weeklyUseOverride),
      leadTimeWeeks: leadWeeks(product.leadTimeDays),
      safetyWeeks: product.safetyWeeks,
      moq: Number(product.moq),
      multiple: Number(product.orderMultiple),
      asOf,
    });
    if (result.tone === "ok" && result.weeklyUse <= 0) continue;
    rows.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      onHand: Math.round(hand * 100) / 100,
      onOrder: Math.round(ordered * 100) / 100,
      weeklyUse: result.weeklyUse,
      weeksLeft: result.weeksLeft,
      runOut: result.runOut,
      suggestedQty: result.suggestedQty,
      tone: result.tone,
      vendorId: product.preferredVendorId,
    });
  }
  const rank = { red: 0, amber: 1, ok: 2 };
  return rows.sort((a, b) => rank[a.tone] - rank[b.tone] || (a.weeksLeft ?? 999) - (b.weeksLeft ?? 999) || a.sku.localeCompare(b.sku));
}

export async function notifyBuySoon(asOf = todayInput()) {
  const rows = (await loadBuySoon(asOf)).filter((row) => row.tone !== "ok");
  const recipients = await prisma.alertRecipient.findMany({ where: { productId: null, category: "" } });
  const to = recipients.length ? [...new Set(recipients.map((row) => row.email))] : ["marlon@novachem.hn"];
  const text = rows.length
    ? rows.map((row) => `${row.tone === "red" ? "Out before a PO can arrive" : "Order this week"}: ${row.sku} ${row.name}. On hand ${row.onHand} ${row.unit}. About ${row.weeklyUse} a week. ${row.weeksLeft ?? "—"} weeks left. Buy ${row.suggestedQty}.`).join("\n")
    : "No packaging or material is below its cover.";
  const setup = emailSetup();
  const sent = setup.configured && rows.length
    ? await deliverEmail({ from: setup.from, to, subject: `SPIKE buy soon ${asOf}`, text })
    : { ok: false, detail: "Email is not configured. Logged only." };
  await prisma.emailLog.create({
    data: {
      toAddress: to.join(", "),
      subject: `SPIKE buy soon ${asOf}`,
      body: text,
      status: sent.ok ? "SENT" : "SKIPPED",
      detail: sent.detail,
    },
  });
  return { to, status: sent.ok ? "SENT" : "SKIPPED", count: rows.length };
}

export function buySoonAsOf(value: Date = new Date()): string {
  return toDateInput(value);
}
