"use server";

import { parseDateInput } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { convertPlan, dispatchStockAlerts } from "@/lib/services/mrp-run";
import { buildSchedule, emailSchedule, releaseSchedule } from "@/lib/services/schedule-run";
import { parseFbaPosition } from "@/lib/amazon-sp";
import { requireCan } from "./actor";
import { fail, succeed } from "./http";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveTrevorEmail(formData: FormData) {
  await requireCan("editMasters");
  const email = text(formData, "trevorEmail");
  if (email && !email.includes("@")) fail("/settings", "Enter Trevor's email address.");
  await prisma.companyProfile.update({ where: { id: "company" }, data: { trevorEmail: email } });
  succeed("/settings", email ? `Trevor's email is ${email}. Release to Trevor will send the work list there.` : "Trevor's email was cleared.");
}

export async function convertPlanAction() {
  const actor = await requireCan("editMasters");
  const today = new Date().toISOString().slice(0, 10);
  const result = await convertPlan(actor, today);
  if (!result.ok) fail("/planning", result.error);
  const note = result.value.notes.length ? ` ${result.value.notes.join(" ")}` : "";
  succeed("/planning", `Created ${result.value.purchaseOrders} purchase orders and ${result.value.batches} batches.${note}`);
}

export async function saveForecast(formData: FormData) {
  await requireCan("editMasters");
  const productId = text(formData, "productId");
  const channel = text(formData, "channel") || "S";
  const week = parseDateInput(text(formData, "weekOf"));
  const qty = Number(text(formData, "qty"));
  if (!productId || !week || !(qty > 0)) fail("/planning", "Choose a product, a week, and a quantity.");
  if (!["S", "A", "W", "E"].includes(channel)) fail("/planning", "Channel must be S, A, W, or E.");
  await prisma.demandForecast.upsert({
    where: { productId_channel_weekOf: { productId, channel, weekOf: week } },
    update: { qty },
    create: { productId, channel, weekOf: week, qty },
  });
  succeed("/planning", "Forecast saved. It replaces the sales-history rate for that week.");
}

export async function saveRecipient(formData: FormData) {
  await requireCan("editMasters");
  const email = text(formData, "email");
  if (!email.includes("@")) fail("/planning/coverage", "Enter an email address.");
  await prisma.alertRecipient.create({
    data: {
      email,
      productId: text(formData, "productId") || null,
      category: text(formData, "category"),
    },
  });
  succeed("/planning/coverage", "Recipient saved.");
}

export async function setDigest(formData: FormData) {
  await requireCan("editMasters");
  await prisma.companyProfile.update({
    where: { id: "company" },
    data: { emailDigest: formData.get("digest") === "yes" },
  });
  succeed("/planning/coverage", "Email setting saved.");
}

export async function sendAlertsNow() {
  await requireCan("editMasters");
  const result = await dispatchStockAlerts();
  if (!result.configured) {
    fail("/planning/coverage", `Email is not configured. Missing ${result.missing.join(", ")}.`);
  }
  succeed("/planning/coverage", result.sent ? `Sent ${result.sent} stock email${result.sent === 1 ? "" : "s"}.` : "No new low-stock emails. Nothing changed status.");
}

export async function saveFbaStock(formData: FormData) {
  await requireCan("editMasters");
  const parsed = parseFbaPosition(text(formData, "csv"));
  if (parsed.length === 0) fail("/planning/schedule", "Paste rows with sku, fulfillable, and inbound. Nothing was saved.");
  let saved = 0;
  for (const row of parsed) {
    const product = await prisma.product.findFirst({ where: { sku: row.sku.toUpperCase() } });
    if (!product) continue;
    await prisma.fbaBalance.upsert({
      where: { productId: product.id },
      update: { fulfillable: row.fulfillable, inbound: row.inbound, source: "CSV" },
      create: { productId: product.id, fulfillable: row.fulfillable, inbound: row.inbound, source: "CSV" },
    });
    saved += 1;
  }
  if (saved === 0) fail("/planning/schedule", "None of those SKUs are in SPIKE. Nothing was saved.");
  succeed("/planning/schedule", `Saved FBA quantities for ${saved} SKU${saved === 1 ? "" : "s"}.`);
}

export async function releaseToTrevor(formData: FormData) {
  const actor = await requireCan("produce");
  const weeks = Number(text(formData, "weeks") || "8");
  const built = await buildSchedule(undefined, weeks);
  const lines = built.rows.map((row) => {
    const qty = Number(text(formData, `qty-${row.id}`));
    const fba = Number(text(formData, `fba-${row.id}`));
    const due = text(formData, `day-${row.id}`) || row.dueOn;
    const suggested = Number.isFinite(qty) && qty >= 0 ? qty : row.suggested;
    const materials = row.materials.map((material) => {
      const need = Math.round(material.perUnit * suggested * 10000) / 10000;
      const short = Math.max(0, Math.round((need - material.onHand) * 10000) / 10000);
      return { ...material, qty: need, short };
    });
    return {
      ...row,
      suggested,
      fbaReplenish: Number.isFinite(fba) && fba >= 0 ? fba : row.fbaReplenish,
      dueOn: due,
      materials,
      shortage: materials.some((material) => material.short > 0),
    };
  });
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  const emailTo = company?.trevorEmail.trim() ?? "";
  const released = await releaseSchedule(actor, { asOf: built.asOf, windowWeeks: built.weeks, emailTo, lines });
  if (!released.ok) fail("/planning/schedule", released.error);
  if (!emailTo) fail(`/planning/schedule/${released.value.id}`, "The work list is saved. Add Trevor's email in Settings before it can be sent.");
  await emailSchedule(released.value.id, emailTo);
  succeed(`/planning/schedule/${released.value.id}/email`, `Released to Trevor. This is the email, with ${released.value.number}.pdf attached.`);
}
