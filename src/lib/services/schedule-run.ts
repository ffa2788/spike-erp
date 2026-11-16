import { channelOf } from "../mrp";
import { addDaysIso } from "../mrp";
import { PACKAGE_PRESETS, contentsWeightLb, qtyPerUnit, type PackBasisName } from "../formula-math";
import { stockBuckets } from "../inventory";
import { suggestSchedule, type ScheduleRow, type ScheduleSku } from "../schedule";
import { toDateInput } from "../dates";
import { prisma } from "../db";
import { currentStock } from "../read-models";
import { deliverEmail, emailSetup } from "../email";
import { nextNumber, run, type Actor } from "./shared";
import { err, ok, type Result } from "../result";

export async function buildSchedule(asOf = toDateInput(new Date()), windowWeeks = 8) {
  const weeks = Math.min(52, Math.max(1, windowWeeks));
  const windowDays = weeks * 7;
  const start = addDaysIso(asOf, -windowDays);
  const [products, formulas, packages, lines, orderLines, batches, fba, stock, amazonOpen] = await Promise.all([
    prisma.product.findMany({ where: { active: true } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { lines: { include: { ingredient: true } } } }),
    prisma.packagedSku.findMany({ include: { lines: { include: { material: true } }, product: true, outputProduct: true } }),
    prisma.invoiceLine.findMany({
      where: { invoice: { status: { not: "VOID" }, issuedOn: { gte: new Date(`${start}T00:00:00Z`) } } },
      include: { invoice: { include: { party: true } } },
    }),
    prisma.salesOrderLine.findMany({
      where: { order: { status: { in: ["CONFIRMED", "PARTLY_SHIPPED"] } } },
      include: { deliveryLines: true, order: { include: { party: true } } },
    }),
    prisma.productionBatch.findMany({ where: { status: { in: ["PLANNED", "IN_PROCESS"] } } }),
    prisma.fbaBalance.findMany(),
    currentStock(),
    prisma.amazonOrderItem.findMany({ where: { shipped: false, cancelled: false, productId: { not: null } } }),
  ]);
  const packagedOutputs = new Set(packages.map((row) => row.outputProductId));
  const onHand = (id: string) => stockBuckets(stock, id, asOf).available;
  const pullLot = (id: string) =>
    stock
      .filter((lot) => lot.productId === id && lot.qcStatus === "APPROVED")
      .sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999"))[0]?.lotNumber ?? "";
  const salesOf = (id: string) => {
    const rows = lines.filter((line) => line.productId === id);
    const byChannel = { S: 0, A: 0, W: 0, E: 0 };
    for (const row of rows) byChannel[channelOf(row.invoice.channel)] += Number(row.qty);
    return { total: byChannel.S + byChannel.A + byChannel.W, byChannel };
  };
  const openOf = (id: string, amazonOnly: boolean) => {
    const fromOrders = orderLines
      .filter((line) => line.productId === id && (!amazonOnly || line.order.party.channel === "AMAZON"))
      .reduce((sum, line) => sum + Math.max(0, Number(line.qty) - line.deliveryLines.reduce((qty, row) => qty + Number(row.qty), 0)), 0);
    const fromAmazon = amazonOpen
      .filter((line) => line.productId === id)
      .reduce((sum, line) => sum + Number(line.qty), 0);
    return fromOrders + fromAmazon;
  };
  const wipOf = (id: string) => batches.filter((batch) => batch.productId === id).reduce((sum, batch) => sum + Number(batch.plannedQty), 0);
  const fbaOf = (id: string) => fba.find((row) => row.productId === id);

  const skus: ScheduleSku[] = [];
  const push = (sku: ScheduleSku) => skus.push(sku);

  for (const pack of packages) {
    const preset = PACKAGE_PRESETS.find((item) => item.code === pack.packageCode);
    const sales = salesOf(pack.outputProductId);
    const formula = formulas.find((item) => item.productId === pack.productId);
    const gravity = pack.product.specificGravity == null ? null : Number(pack.product.specificGravity);
    const pounds = preset ? contentsWeightLb({ form: preset.form, gallons: preset.gallons, netLb: preset.netLb, specificGravity: gravity }) : null;
    const materials = [
      ...(pounds ? [{ id: pack.productId, name: pack.product.name, requiredPerUnit: pounds, onHand: onHand(pack.productId), unit: pack.product.unit }] : []),
      ...pack.lines.flatMap((line) => {
        const each = qtyPerUnit({ basis: line.basis as PackBasisName, qty: Number(line.qty), unitsPerCase: pack.unitsPerCase, casesPerPallet: pack.casesPerPallet });
        if (!each) return [];
        return [{ id: line.materialId, name: line.material.name, requiredPerUnit: each, onHand: onHand(line.materialId), unit: line.material.unit }];
      }),
    ];
    const balance = fbaOf(pack.outputProductId);
    push({
      id: pack.outputProductId,
      sku: pack.outputProduct.sku,
      name: pack.outputProduct.name,
      packageLabel: preset?.label ?? pack.packageCode,
      unit: pack.outputProduct.unit,
      multiple: pack.unitsPerCase > 1 ? pack.unitsPerCase : 1,
      coverDays: pack.outputProduct.coverDays || 14,
      salesQty: sales.total,
      windowDays,
      salesByChannel: sales.byChannel,
      openOrders: openOf(pack.outputProductId, false),
      amazonOpenOrders: openOf(pack.outputProductId, true),
      supermarket: onHand(pack.outputProductId),
      fbaFulfillable: balance ? Number(balance.fulfillable) : 0,
      fbaInbound: balance ? Number(balance.inbound) : 0,
      wip: wipOf(pack.outputProductId),
      formulaVersion: formula?.version ?? null,
      pullLot: pullLot(pack.productId),
      materials,
    });
  }
  for (const product of products) {
    if (product.kind !== "FINISHED" || packagedOutputs.has(product.id)) continue;
    const sales = salesOf(product.id);
    if (sales.total <= 0 && openOf(product.id, false) <= 0) continue;
    const formula = formulas.find((item) => item.productId === product.id);
    const balance = fbaOf(product.id);
    push({
      id: product.id,
      sku: product.sku,
      name: product.name,
      packageLabel: "Bulk",
      unit: product.unit,
      multiple: Number(product.orderMultiple) > 1 ? Number(product.orderMultiple) : 1,
      coverDays: product.coverDays || 14,
      salesQty: sales.total,
      windowDays,
      salesByChannel: sales.byChannel,
      openOrders: openOf(product.id, false),
      amazonOpenOrders: openOf(product.id, true),
      supermarket: onHand(product.id),
      fbaFulfillable: balance ? Number(balance.fulfillable) : 0,
      fbaInbound: balance ? Number(balance.inbound) : 0,
      wip: wipOf(product.id),
      formulaVersion: formula?.version ?? null,
      pullLot: pullLot(product.id),
      materials: (formula?.lines ?? []).map((line) => ({
        id: line.ingredientId,
        name: line.ingredient.name,
        requiredPerUnit: Number(line.percent) / 100,
        onHand: onHand(line.ingredientId),
        unit: line.ingredient.unit,
      })),
    });
  }
  return { asOf, weeks, rows: suggestSchedule({ asOf, skus }) };
}

export async function releaseSchedule(
  actor: Actor,
  input: { asOf: string; windowWeeks: number; emailTo: string; lines: ScheduleRow[] },
): Promise<Result<{ id: string; number: string }>> {
  const chosen = input.lines.filter((line) => line.suggested > 0 || line.fbaReplenish > 0);
  if (chosen.length === 0) return err("Nothing to release. Every SKU already covers the target.");
  return run(async (tx) => {
    const number = await nextNumber(tx, "schedule");
    const release = await tx.scheduleRelease.create({
      data: {
        number,
        weekOf: new Date(`${input.asOf}T12:00:00Z`),
        windowWeeks: input.windowWeeks,
        emailedTo: input.emailTo,
        lines: {
          create: chosen.map((line) => ({
            productId: line.id,
            sku: line.sku,
            name: line.name,
            packageLabel: line.packageLabel,
            qty: line.suggested,
            fbaQty: line.fbaReplenish,
            unit: line.unit,
            dueOn: new Date(`${(line.dueOn || input.asOf)}T12:00:00Z`),
            formulaVersion: line.formulaVersion,
            pullLot: line.pullLot,
            materials: line.materials.map((material) => `${material.name}: ${material.qty} ${material.unit}${material.short > 0 ? ` (short ${material.short})` : ""}`).join("\n"),
            daysCover: line.daysCover,
            shortage: line.shortage,
          })),
        },
      },
    });
    return ok({ id: release.id, number });
  });
}

export async function emailSchedule(releaseId: string, emailTo: string) {
  const setup = emailSetup();
  const release = await prisma.scheduleRelease.findUnique({ where: { id: releaseId }, include: { lines: true } });
  if (!release || !emailTo) return;
  const text = release.lines.map((line) => `${toDateInput(line.dueOn)} ${line.sku} ${line.packageLabel}: make ${line.qty} ${line.unit}. FBA ship ${line.fbaQty}. ${line.materials}`).join("\n");
  if (!setup.configured) {
    await prisma.emailLog.create({
      data: { toAddress: emailTo, subject: `Schedule ${release.number}`, body: text, status: "SKIPPED", detail: "Email is not configured." },
    });
    await prisma.scheduleRelease.update({ where: { id: releaseId }, data: { emailedTo: emailTo } });
    return;
  }
  const sent = await deliverEmail({ from: setup.from, to: [emailTo], subject: `Production schedule ${release.number} for Trevor`, text });
  await prisma.emailLog.create({
    data: { toAddress: emailTo, subject: `Production schedule ${release.number}`, body: text, status: sent.ok ? "SENT" : "FAILED", detail: sent.detail },
  });
  await prisma.scheduleRelease.update({ where: { id: releaseId }, data: { emailedTo: emailTo } });
}
