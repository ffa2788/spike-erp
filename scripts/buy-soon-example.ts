import "dotenv/config";
import { prisma } from "../src/lib/db";
import { savePurchaseOrder, receivePurchaseOrder } from "../src/lib/services/purchasing";
import { releaseLot } from "../src/lib/services/production";
import { packGoods } from "../src/lib/services/pack";
import { notifyBuySoon } from "../src/lib/services/buy-soon";
import type { Actor } from "../src/lib/services/shared";

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  return result.value;
}

async function main() {
  const already = await prisma.packRun.findFirst({ where: { packedOn: new Date("2026-10-26T12:00:00Z") } });
  if (already) {
    console.log("October packs are already on file.");
    console.log(await notifyBuySoon("2026-11-18"));
    return;
  }
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", active: true } });
  const actor: Actor = { id: owner.id, name: owner.name, role: "OWNER" };
  const vendor = await prisma.party.findFirstOrThrow({ where: { isVendor: true, active: true } });
  const need = ["PKG-JUG-1", "PKG-CAP", "PKG-LABEL", "PKG-PALLET", "PKG-WRAP", "RUST-PREV", "RUST-1G"];
  const products = await prisma.product.findMany({ where: { sku: { in: need } } });
  const id = new Map(products.map((row) => [row.sku, row.id]));
  for (const sku of need) if (!id.get(sku)) throw new Error(`Missing ${sku}`);
  await prisma.product.update({ where: { sku: "PKG-JUG-1" }, data: { leadTimeDays: 7, moq: 48, orderMultiple: 12, safetyWeeks: 2, preferredVendorId: vendor.id } });
  await prisma.product.update({ where: { sku: "PKG-CAP" }, data: { leadTimeDays: 42, moq: 24, orderMultiple: 12, safetyWeeks: 2, preferredVendorId: vendor.id } });
  await prisma.product.update({ where: { sku: "PKG-LABEL" }, data: { leadTimeDays: 14, moq: 50, orderMultiple: 10, safetyWeeks: 2, preferredVendorId: vendor.id } });
  await prisma.product.update({ where: { sku: "PKG-PALLET" }, data: { leadTimeDays: 21, moq: 4, orderMultiple: 1, safetyWeeks: 2, preferredVendorId: vendor.id } });
  await prisma.product.update({ where: { sku: "PKG-WRAP" }, data: { leadTimeDays: 7, moq: 2, orderMultiple: 1, safetyWeeks: 2, preferredVendorId: vendor.id } });
  await prisma.packagedSku.updateMany({ where: { outputProductId: id.get("RUST-1G") }, data: { casesPerPallet: 2 } });
  const existing = await prisma.purchaseOrder.findFirst({ where: { notes: { contains: "Example October materials" } }, include: { lines: true, receipts: true } });
  const po = existing ? { id: existing.id } : must(await savePurchaseOrder(actor, {
    partyId: vendor.id,
    orderedOn: new Date("2026-09-15T12:00:00Z"),
    expectedOn: new Date("2026-09-28T12:00:00Z"),
    notes: "Example October materials. Not a real purchase.",
    send: true,
    isExample: true,
    lines: [
      { productId: id.get("RUST-PREV")!, qty: 4000, unitPrice: 1.2 },
      { productId: id.get("PKG-JUG-1")!, qty: 2000, unitPrice: 0.85 },
      { productId: id.get("PKG-LABEL")!, qty: 200, unitPrice: 0.08 },
      { productId: id.get("PKG-PALLET")!, qty: 10, unitPrice: 12 },
      { productId: id.get("PKG-WRAP")!, qty: 4, unitPrice: 3 },
    ],
  }), "po");
  const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true, receipts: true } });
  const receipt = order.receipts[0] ? { receiptId: order.receipts[0].id } : must(await receivePurchaseOrder(actor, {
    orderId: order.id,
    receivedOn: new Date("2026-09-28T12:00:00Z"),
    notes: "Example receipt.",
    lines: order.lines.map((line) => ({ orderLineId: line.id, qty: Number(line.qty), supplierLot: "EX-OCT", expiresOn: null })),
  }), "receive");
  const lots = await prisma.lot.findMany({ where: { receiptLines: { some: { receiptId: receipt.receiptId } } } });
  for (const lot of lots) {
    if (lot.qcStatus === "APPROVED") continue;
    const specs = await prisma.qualitySpec.findMany({ where: { productId: lot.productId } });
    const results = specs.map((spec) => ({
      parameter: spec.parameter,
      value: spec.target != null ? Number(spec.target) : spec.min != null && spec.max != null ? (Number(spec.min) + Number(spec.max)) / 2 : 7,
    }));
    must(await releaseLot(actor, { lotId: lot.id, releasedOn: new Date("2026-09-29T12:00:00Z"), results, confirmation: "RELEASE" }), lot.lotNumber);
  }
  const corner = await prisma.product.findUniqueOrThrow({ where: { sku: "PKG-CORNER" } });
  if (!(await prisma.purchaseOrder.findFirst({ where: { notes: "Example corner boards for October." } }))) {
    const extra = must(await savePurchaseOrder(actor, {
      partyId: vendor.id,
      orderedOn: new Date("2026-09-15T12:00:00Z"),
      expectedOn: new Date("2026-09-28T12:00:00Z"),
      notes: "Example corner boards for October.",
      send: true,
      isExample: true,
      lines: [{ productId: corner.id, qty: 160, unitPrice: 0.35 }],
    }), "corners");
    const cornerOrder = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: extra.id }, include: { lines: true } });
    const cornerReceipt = must(await receivePurchaseOrder(actor, {
      orderId: cornerOrder.id,
      receivedOn: new Date("2026-09-28T12:00:00Z"),
      notes: "Example corner receipt.",
      lines: cornerOrder.lines.map((line) => ({ orderLineId: line.id, qty: Number(line.qty), supplierLot: "EX-CORNER", expiresOn: null })),
    }), "corner receive");
    const cornerLots = await prisma.lot.findMany({ where: { receiptLines: { some: { receiptId: cornerReceipt.receiptId } } } });
    for (const lot of cornerLots) {
      must(await releaseLot(actor, { lotId: lot.id, releasedOn: new Date("2026-09-29T12:00:00Z"), results: [], confirmation: "RELEASE" }), lot.lotNumber);
    }
  }
  const packaged = await prisma.packagedSku.findFirstOrThrow({ where: { outputProductId: id.get("RUST-1G") } });
  for (const day of ["2026-10-01", "2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15", "2026-10-19", "2026-10-22", "2026-10-26"]) {
    const when = new Date(`${day}T12:00:00Z`);
    const done = await prisma.packRun.findFirst({ where: { packagedSkuId: packaged.id, packedOn: when } });
    if (done) continue;
    must(await packGoods(actor, { packagedSkuId: packaged.id, units: 40, packedOn: when }), day);
  }
  console.log(await notifyBuySoon("2026-11-18"));
}

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
