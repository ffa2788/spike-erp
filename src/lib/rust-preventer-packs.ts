/**
 * 0.5 gal Rust Preventer packs. Same formula as RUST-PREVENTER-1.
 * Fill the nulls in this file when the values are known. Do not invent them.
 */
export const RUST_PREVENTER_SKU = "RUST-PREVENTER-1";

export const halfGallonJug: { sku: string | null; costDollars: number | null } = {
  sku: null,
  costDollars: null,
};

export const halfGallonPackSkus: { twoPack: string | null; fourPack: string | null } = {
  twoPack: null,
  fourPack: null,
};

export type HalfGallonPack = {
  sku: string;
  name: string;
  jugs: number;
  gallonsEach: 0.5;
  packageCode: "LIQ-0.5";
  jugSku: string;
  jugCostDollars: number;
};

export function halfGallonPackPlan(input?: {
  jugSku?: string | null;
  jugCostDollars?: number | null;
  twoPackSku?: string | null;
  fourPackSku?: string | null;
}): { ok: true; bulkSku: string; jugSku: string; jugCostDollars: number; packs: HalfGallonPack[] } | { ok: false; missing: string[] } {
  const jugSku = input?.jugSku === undefined ? halfGallonJug.sku : input.jugSku;
  const jugCostDollars = input?.jugCostDollars === undefined ? halfGallonJug.costDollars : input.jugCostDollars;
  const twoPackSku = input?.twoPackSku === undefined ? halfGallonPackSkus.twoPack : input.twoPackSku;
  const fourPackSku = input?.fourPackSku === undefined ? halfGallonPackSkus.fourPack : input.fourPackSku;
  const missing: string[] = [];
  if (!jugSku?.trim()) missing.push("jug SKU");
  if (jugCostDollars == null) missing.push("jug cost");
  if (!twoPackSku?.trim()) missing.push("2-pack SKU");
  if (!fourPackSku?.trim()) missing.push("4-pack SKU");
  if (missing.length || jugSku == null || jugCostDollars == null || twoPackSku == null || fourPackSku == null) {
    return { ok: false, missing };
  }
  const packs = [
    { sku: twoPackSku.trim(), name: "Rust Preventer, 0.5 gal, 2-pack", jugs: 2 },
    { sku: fourPackSku.trim(), name: "Rust Preventer, 0.5 gal, 4-pack", jugs: 4 },
  ].map((pack) => ({
    ...pack,
    gallonsEach: 0.5 as const,
    packageCode: "LIQ-0.5" as const,
    jugSku: jugSku.trim(),
    jugCostDollars,
  }));
  return { ok: true, bulkSku: RUST_PREVENTER_SKU, jugSku: jugSku.trim(), jugCostDollars, packs };
}
