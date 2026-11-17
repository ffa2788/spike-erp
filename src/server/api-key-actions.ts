"use server";

import { prisma } from "@/lib/db";
import { generateApiKey, SPIKE_SCOPES } from "@/lib/spike-auth";
import { requireActor } from "./actor";
import { fail, succeed } from "./http";

function allowed() {
  return requireActor().then((actor) => {
    if (actor.role !== "OWNER" && actor.role !== "PARTNER") fail("/settings?tab=integrations", "Only FFA or Chris can create a bot key.");
    return actor;
  });
}

export async function createApiKey(formData: FormData) {
  await allowed();
  const name = String(formData.get("name") ?? "").trim() || "SPIKE bot";
  const scopes = SPIKE_SCOPES.filter((scope) => formData.get(scope) === "yes");
  if (!scopes.includes("read")) scopes.unshift("read");
  const key = generateApiKey();
  await prisma.apiKey.create({ data: { name, prefix: key.prefix, hash: key.hash, scopes: scopes.join(",") } });
  succeed("/settings?tab=integrations", `Copy this key now. It will not be shown again: ${key.raw}`);
}

export async function revokeApiKey(formData: FormData) {
  await allowed();
  const id = String(formData.get("id") ?? "");
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  succeed("/settings?tab=integrations", "That key can no longer call the API.");
}
