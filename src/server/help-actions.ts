"use server";

import { deliverEmail, emailSetup } from "@/lib/email";
import { helpBack, helpNotice } from "@/lib/help";
import { mayEditManual, missingAnchors } from "@/lib/manual";
import { prisma } from "@/lib/db";
import { requireActor } from "./actor";
import { fail, succeed } from "./http";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveManual(formData: FormData) {
  const actor = await requireActor();
  if (!mayEditManual(actor.role)) fail("/settings?tab=manual", "Only the owner can edit the manual.");
  const body = String(formData.get("body") ?? "");
  if (body.trim().length < 40) fail("/settings?tab=manual", "The manual cannot be empty.");
  const missing = missingAnchors(body);
  if (missing.length) fail("/settings?tab=manual", `Keep these sections: ${missing.join(", ")}.`);
  await prisma.operatingManual.upsert({
    where: { id: "manual" },
    update: { body, updatedBy: actor.name },
    create: { id: "manual", body, updatedBy: actor.name },
  });
  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      userName: actor.name,
      action: "update",
      entity: "OperatingManual",
      entityId: "manual",
      summary: `${actor.name} updated the operating manual.`,
    },
  });
  succeed("/settings?tab=manual", "Manual saved.");
}

export async function openHelpRequest(formData: FormData) {
  const actor = await requireActor();
  const back = helpBack(text(formData, "back") || "/");
  const message = text(formData, "message");
  const screen = text(formData, "screen").slice(0, 300) || "/";
  const recordRef = text(formData, "record").slice(0, 200);
  if (message.length < 3) fail(back, "Say what is stuck.");
  const file = formData.get("screenshot");
  let screenshot: Uint8Array<ArrayBuffer> | null = null;
  let screenshotName = "";
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith("image/")) fail(back, "The picture must be an image.");
    if (file.size > 2_000_000) fail(back, "The picture is too large. Keep it under 2 MB.");
    const raw = await file.arrayBuffer();
    const copy = new ArrayBuffer(raw.byteLength);
    new Uint8Array(copy).set(new Uint8Array(raw));
    screenshot = new Uint8Array(copy);
    screenshotName = file.name.slice(0, 120);
  }
  const row = await prisma.helpRequest.create({
    data: {
      userId: actor.id,
      userName: actor.name,
      screen,
      recordRef,
      message,
      status: "open",
      screenshot,
      screenshotName,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      userName: actor.name,
      action: "create",
      entity: "HelpRequest",
      entityId: row.id,
      summary: `${actor.name} asked for help on ${screen}.`,
    },
  });
  await notifyOwner({ fromName: actor.name, screen, recordRef, message });
  succeed(back, "Help request sent. FFA was notified.");
}

export async function closeHelpRequest(formData: FormData) {
  const actor = await requireActor();
  const id = text(formData, "id");
  const back = helpBack(text(formData, "back") || "/");
  const row = await prisma.helpRequest.findUnique({ where: { id } });
  if (!row) fail(back, "That help request is gone.");
  if (row.userId !== actor.id && actor.role !== "OWNER") fail(back, "You can close your own help requests.");
  await prisma.helpRequest.update({ where: { id }, data: { status: "closed" } });
  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      userName: actor.name,
      action: "close",
      entity: "HelpRequest",
      entityId: id,
      summary: `${actor.name} closed help request ${id}.`,
    },
  });
  succeed(back, "Marked closed.");
}

async function notifyOwner(input: { fromName: string; screen: string; recordRef: string; message: string }) {
  const owner = await prisma.user.findFirst({ where: { role: "OWNER", active: true }, orderBy: { createdAt: "asc" } });
  const notice = helpNotice({ ...input, ownerEmail: owner?.email ?? null });
  if ("skip" in notice) {
    await prisma.emailLog.create({
      data: { toAddress: "", subject: "Help request", body: input.message, status: "SKIPPED", detail: notice.skip },
    });
    return;
  }
  const setup = emailSetup();
  const result = setup.configured
    ? await deliverEmail({ from: setup.from, to: notice.to, subject: notice.subject, text: notice.text })
    : { ok: false, detail: "Email is not configured. Logged only." };
  await prisma.emailLog.create({
    data: {
      toAddress: notice.to.join(", "),
      subject: notice.subject,
      body: notice.text,
      status: result.ok ? "SENT" : "SKIPPED",
      detail: result.detail,
    },
  });
}
