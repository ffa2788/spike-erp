import { channelOf, independentDemand, runMrp, type ChannelCode, type DatedQty, type MrpItem } from "../mrp";
import { coverItem, type CoverStatus } from "../coverage";
import { stockAlerts } from "../alerts";
import { deliverEmail, emailSetup } from "../email";
import { PACKAGE_PRESETS, contentsWeightLb, qtyPerUnit, type PackBasisName } from "../formula-math";
import { stockBuckets } from "../inventory";
import { toDateInput } from "../dates";
import { prisma } from "../db";
import { currentStock } from "../read-models";
import { err, ok, type Result } from "../result";
import { savePurchaseOrder } from "./purchasing";
import { createBatch } from "./production";
import { packGoods } from "./pack";
import type { Actor } from "./shared";

export async function buildPlan(asOf = toDateInput(new Date())) {
  const [products, formulas, packages, orders, poLines, invoices, forecasts, batches, stock] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, include: { preferredVendor: true } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } }),
    prisma.packagedSku.findMany({ include: { lines: true, product: true } }),
    prisma.salesOrderLine.findMany({
      where: { order: { status: { in: ["CONFIRMED", "PARTLY_SHIPPED"] } } },
      include: { deliveryLines: true, order: { include: { party: true } } },
    }),
    prisma.purchaseOrderLine.findMany({
      where: { order: { status: { in: ["SENT", "PARTLY_RECEIVED"] } } },
      include: { order: true },
    }),
    prisma.invoiceLine.findMany({
      where: { invoice: { status: { not: "VOID" }, issuedOn: { gte: new Date(`${addDays(asOf, -84)}T00:00:00Z`) } } },
      include: { invoice: true },
    }),
    prisma.demandForecast.findMany(),
    prisma.productionBatch.findMany({ where: { status: { in: ["PLANNED", "IN_PROCESS"] } } }),
    currentStock(),
  ]);
  const formulaIds = new Set(formulas.map((formula) => formula.productId));
  const packaged = new Set(packages.map((row) => row.outputProductId));
  const items: MrpItem[] = products.filter((product) => product.kind !== "UTILITY").map((product) => {
    const buckets = stockBuckets(stock, product.id, asOf);
    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
      kind: product.kind,
      leadTimeDays: product.leadTimeDays ?? product.preferredVendor?.leadTimeDays ?? (product.kind === "FINISHED" ? 7 : 14),
      reorderPoint: Number(product.minQty),
      safetyQty: Number(product.safetyQty),
      maxQty: Number(product.maxQty),
      moq: Number(product.moq),
      multiple: Number(product.orderMultiple),
      onHandReleased: buckets.available,
      onHandQuarantine: buckets.quarantine,
      make: formulaIds.has(product.id) || packaged.has(product.id),
    };
  });
  const bom = [
    ...formulas.flatMap((formula) => formula.lines.map((line) => ({
      parentId: formula.productId,
      componentId: line.ingredientId,
      qtyPer: Number(line.percent) / 100,
    }))),
    ...packages.flatMap((sku) => {
      const preset = PACKAGE_PRESETS.find((item) => item.code === sku.packageCode);
      const gravity = sku.product.specificGravity == null ? null : Number(sku.product.specificGravity);
      const pounds = preset ? contentsWeightLb({ form: preset.form, gallons: preset.gallons, netLb: preset.netLb, specificGravity: gravity }) : null;
      const links = pounds ? [{ parentId: sku.outputProductId, componentId: sku.productId, qtyPer: pounds }] : [];
      for (const line of sku.lines) {
        const each = qtyPerUnit({
          basis: line.basis as PackBasisName,
          qty: Number(line.qty),
          unitsPerCase: sku.unitsPerCase,
          casesPerPallet: sku.casesPerPallet,
        });
        if (each) links.push({ parentId: sku.outputProductId, componentId: line.materialId, qtyPer: each });
      }
      return links;
    }),
  ];
  const ordersDemand: DatedQty[] = orders.map((line) => {
    const shipped = line.deliveryLines.reduce((sum, row) => sum + Number(row.qty), 0);
    return {
      itemId: line.productId,
      date: toDateInput(line.order.orderedOn),
      qty: Math.max(0, Number(line.qty) - shipped),
      channel: channelOf(line.order.party.channel),
      source: "ORDER",
    };
  });
  const history: DatedQty[] = invoices.map((line) => ({
    itemId: line.productId,
    date: toDateInput(line.invoice.issuedOn),
    qty: Number(line.qty),
    channel: channelOf(line.invoice.channel),
    source: "HISTORY",
  }));
  const manual: DatedQty[] = forecasts.map((row) => ({
    itemId: row.productId,
    date: toDateInput(row.weekOf),
    qty: Number(row.qty),
    channel: (row.channel === "A" || row.channel === "W" ? row.channel : "S") as ChannelCode,
    source: "FORECAST",
  }));
  const independent = independentDemand({ asOf, orders: ordersDemand, history, manual });
  const openSupply = [
    ...poLines.map((line) => ({
      itemId: line.productId,
      date: toDateInput(line.order.expectedOn ?? line.order.orderedOn),
      qty: Math.max(0, Number(line.qty) - Number(line.qtyReceived)),
    })),
    ...batches.map((batch) => ({
      itemId: batch.productId,
      date: asOf,
      qty: Number(batch.plannedQty),
    })),
  ];
  const plan = runMrp({ asOf, items, bom, independent, openSupply });
  const byId = new Map(products.map((product) => [product.id, product]));
  const openPo = new Map<string, number>();
  for (const line of poLines) {
    openPo.set(line.productId, (openPo.get(line.productId) ?? 0) + Math.max(0, Number(line.qty) - Number(line.qtyReceived)));
  }
  const usage = new Map<string, number>();
  for (const row of history) usage.set(row.itemId, (usage.get(row.itemId) ?? 0) + row.qty);
  const coverage = items.map((item) => {
    const weeks = plan.gross.get(item.id) ?? Array(12).fill(0);
    const suggested = plan.planned.filter((row) => row.itemId === item.id).reduce((sum, row) => sum + row.qty, 0);
    const covered = coverItem({
      onHand: item.onHandReleased,
      reorderPoint: item.reorderPoint,
      safetyQty: item.safetyQty,
      leadTimeDays: item.leadTimeDays,
      weeklyUsage: Math.round(((usage.get(item.id) ?? 0) / 12) * 10000) / 10000,
      demandByWeek: weeks,
      suggestedQty: suggested,
      openPoQty: openPo.get(item.id) ?? 0,
      unit: item.unit,
    });
    const product = byId.get(item.id)!;
    return { item, product, ...covered, openPoQty: openPo.get(item.id) ?? 0, suggestedQty: suggested, weeklyUsage: (usage.get(item.id) ?? 0) / 12 };
  });
  return { asOf, items, plan, coverage, products };
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function convertPlan(actor: Actor, asOf: string): Promise<Result<{ purchaseOrders: number; batches: number; notes: string[] }>> {
  const { plan, products } = await buildPlan(asOf);
  const byId = new Map(products.map((product) => [product.id, product]));
  const notes: string[] = [];
  let purchaseOrders = 0;
  let batches = 0;
  const purchases = new Map<string, { productId: string; qty: number; unitPrice: number }[]>();
  for (const row of plan.planned) {
    const product = byId.get(row.itemId);
    if (!product) continue;
    if (row.kind === "PURCHASE") {
      if (!product.preferredVendorId) {
        notes.push(`${product.name} needs a preferred supplier before a purchase order can be created.`);
        continue;
      }
      const price = Number(product.standardCost);
      if (!(price > 0)) {
        notes.push(`${product.name} has no cost, so the purchase order was not created.`);
        continue;
      }
      const list = purchases.get(product.preferredVendorId) ?? [];
      list.push({ productId: product.id, qty: row.qty, unitPrice: price });
      purchases.set(product.preferredVendorId, list);
    } else {
      const packaged = await prisma.packagedSku.findFirst({ where: { outputProductId: product.id } });
      if (packaged && Number.isInteger(row.qty)) {
        const packed = await packGoods(actor, { packagedSkuId: packaged.id, units: row.qty, packedOn: new Date(`${row.dueOn}T12:00:00Z`) });
        if (!packed.ok) notes.push(`${product.name}: ${packed.error}`);
        else batches += 1;
      } else {
        const made = await createBatch(actor, { productId: product.id, plannedQty: row.qty, notes: `MRP due ${row.dueOn}. ${row.note}` });
        if (!made.ok) notes.push(`${product.name}: ${made.error}`);
        else batches += 1;
      }
    }
  }
  for (const [partyId, lines] of purchases) {
    const saved = await savePurchaseOrder(actor, {
      partyId,
      orderedOn: new Date(`${asOf}T12:00:00Z`),
      expectedOn: new Date(`${asOf}T12:00:00Z`),
      notes: "Created from the materials plan.",
      send: true,
      lines,
    });
    if (!saved.ok) notes.push(saved.error);
    else purchaseOrders += 1;
  }
  if (purchaseOrders === 0 && batches === 0 && notes.length === 0) return err("Nothing in the plan can be turned into an order.");
  return ok({ purchaseOrders, batches, notes });
}

export async function dispatchStockAlerts(asOf = toDateInput(new Date())) {
  const setup = emailSetup();
  const built = await buildPlan(asOf);
  const [recipients, previous, company] = await Promise.all([
    prisma.alertRecipient.findMany(),
    prisma.stockAlert.findMany(),
    prisma.companyProfile.findUnique({ where: { id: "company" } }),
  ]);
  const defaults = recipients.filter((row) => !row.productId && !row.category).map((row) => row.email);
  const items = built.coverage.map((row) => {
    const specific = recipients.filter((item) => item.productId === row.item.id).map((item) => item.email);
    const category = recipients.filter((item) => item.category && item.category === row.product.category).map((item) => item.email);
    const list = specific.length ? specific : category.length ? category : defaults;
    return {
      id: row.item.id,
      sku: row.product.sku,
      name: row.item.name,
      status: row.status as CoverStatus,
      onHand: row.item.onHandReleased,
      unit: row.item.unit,
      daysCover: row.daysVsUsage,
      openPoQty: row.openPoQty,
      suggestedQty: row.suggestedQty,
      recipients: [...new Set(list)],
    };
  });
  const decision = stockAlerts({
    asOf,
    digest: Boolean(company?.emailDigest),
    lastDigestOn: company?.lastDigestOn ? toDateInput(company.lastDigestOn) : null,
    items,
    previous: previous.map((row) => ({
      itemId: row.productId,
      status: row.status as CoverStatus,
      emailedOn: row.emailedOn ? toDateInput(row.emailedOn) : null,
    })),
  });
  if (!setup.configured) {
    return { configured: false as const, missing: setup.missing, pending: decision.messages.length, coverage: built.coverage };
  }
  let sent = 0;
  for (const message of decision.messages) {
    const result = await deliverEmail({ from: setup.from, to: message.to, subject: message.subject, text: message.text });
    await prisma.emailLog.create({
      data: {
        toAddress: message.to.join(", "),
        subject: message.subject,
        body: message.text,
        status: result.ok ? "SENT" : "FAILED",
        detail: result.detail,
      },
    });
    if (result.ok) sent += 1;
  }
  for (const row of decision.emailed) {
    await prisma.stockAlert.upsert({
      where: { productId: row.itemId },
      update: { status: row.status, emailedOn: new Date(`${asOf}T12:00:00Z`) },
      create: { productId: row.itemId, status: row.status, emailedOn: new Date(`${asOf}T12:00:00Z`) },
    });
  }
  if (company?.emailDigest && decision.messages.length > 0) {
    await prisma.companyProfile.update({ where: { id: "company" }, data: { lastDigestOn: new Date(`${asOf}T12:00:00Z`) } });
  }
  return { configured: true as const, sent, pending: decision.messages.length, coverage: built.coverage };
}
