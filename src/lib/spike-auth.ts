import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SPIKE_SCOPES = ["read", "sales", "purchasing", "planning", "money"] as const;
export type SpikeScope = (typeof SPIKE_SCOPES)[number];

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `spike_${randomBytes(24).toString("base64url")}`;
  return { raw, prefix: raw.slice(0, 14), hash: hashApiKey(raw) };
}

export function parseScopes(value: string): SpikeScope[] {
  const wanted = new Set(value.split(",").map((item) => item.trim()));
  return SPIKE_SCOPES.filter((scope) => wanted.has(scope));
}

export function scopeAllows(scopes: string, needed: SpikeScope): boolean {
  return parseScopes(scopes).includes(needed);
}

export function keysMatch(storedHash: string, raw: string): boolean {
  const next = hashApiKey(raw);
  const left = Buffer.from(storedHash);
  const right = Buffer.from(next);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
