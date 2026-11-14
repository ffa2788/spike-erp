"use server";

import { parseDateInput } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { convertPlan, dispatchStockAlerts } from "@/lib/services/mrp-run";
import { requireCan } from "./actor";
import { fail, succeed } from "./http";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
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
  if (!["S", "A", "W"].includes(channel)) fail("/planning", "Channel must be S, A, or W.");
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
