"use server";

import { prisma } from "@/lib/db";
import { savePurchaseOrder } from "@/lib/services/purchasing";
import { requireActor } from "./actor";
import { fail, succeed } from "./http";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveWeeklyUse(formData: FormData) {
  const actor = await requireActor();
  if (actor.role !== "OWNER" && actor.role !== "PARTNER") fail("/inventory?tab=low", "Only FFA or Chris can change the weekly use.");
  const id = text(formData, "productId");
  const raw = text(formData, "weekly");
  const weekly = raw === "" ? null : Number(raw);
  if (weekly != null && !(weekly >= 0)) fail("/inventory?tab=low", "Weekly use cannot be negative.");
  await prisma.product.update({ where: { id }, data: { weeklyUseOverride: weekly } });
  succeed("/inventory?tab=low", weekly == null ? "Using the last eight weeks again." : "Weekly use saved.");
}

export async function createBuyPo(formData: FormData) {
  const actor = await requireActor();
  const id = text(formData, "productId");
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) fail("/inventory?tab=low", "That item is gone.");
  const qty = Number(text(formData, "qty"));
  if (!(qty > 0)) fail("/inventory?tab=low", "Nothing to buy.");
  const vendorId = product.preferredVendorId ?? (await prisma.party.findFirst({ where: { isVendor: true, active: true }, orderBy: { name: "asc" } }))?.id;
  if (!vendorId) fail("/inventory?tab=low", "Add a supplier before creating the purchase order.");
  const price = Number(product.standardCost) > 0 && Math.abs(Number(product.standardCost) - 1) > 0.0001 ? Number(product.standardCost) : 0.5;
  const saved = await savePurchaseOrder(actor, {
    partyId: vendorId,
    orderedOn: new Date(),
    expectedOn: null,
    notes: "Draft from Buy soon. Example data.",
    send: false,
    isExample: true,
    lines: [{ productId: product.id, qty, unitPrice: price }],
  });
  if (!saved.ok) fail("/inventory?tab=low", saved.error);
  succeed("/purchasing?tab=orders", "Draft purchase order created.");
}
