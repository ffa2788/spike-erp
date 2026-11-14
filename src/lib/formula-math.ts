/** Water at about 60°F. Specific gravity times this number is pounds per gallon. */
export const WATER_LB_PER_GALLON = 8.34;
export const LB_PER_KG = 2.2046226218;

export type ProductFormName = "LIQUID" | "POWDER";
export type PackBasisName = "UNIT" | "CASE" | "PALLET";

export const PACKAGE_PRESETS: {
  code: string;
  form: ProductFormName;
  label: string;
  gallons: number | null;
  netLb: number | null;
}[] = [
  { code: "LIQ-0.5", form: "LIQUID", label: "0.5 gal", gallons: 0.5, netLb: null },
  { code: "LIQ-1", form: "LIQUID", label: "1 gal", gallons: 1, netLb: null },
  { code: "LIQ-2.5", form: "LIQUID", label: "2.5 gal", gallons: 2.5, netLb: null },
  { code: "LIQ-35", form: "LIQUID", label: "35 gal drum", gallons: 35, netLb: null },
  { code: "LIQ-55", form: "LIQUID", label: "55 gal drum", gallons: 55, netLb: null },
  { code: "LIQ-255", form: "LIQUID", label: "255 gal tote", gallons: 255, netLb: null },
  { code: "LIQ-265", form: "LIQUID", label: "265 gal tote", gallons: 265, netLb: null },
  { code: "PWD-25KG", form: "POWDER", label: "25 kg bag", gallons: null, netLb: round4(25 * LB_PER_KG) },
  { code: "PWD-50LB", form: "POWDER", label: "50 lb bag", gallons: null, netLb: 50 },
];

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function formulaFromPounds(lines: { key: string; pounds: number }[]):
  | { ok: true; totalLb: number; lines: { key: string; pounds: number; percent: number }[] }
  | { ok: false; error: string } {
  if (lines.length === 0) return { ok: false, error: "Add at least one ingredient." };
  if (lines.some((line) => !(line.pounds > 0))) {
    return { ok: false, error: "Every ingredient needs a weight in pounds greater than zero." };
  }
  const totalLb = round4(lines.reduce((sum, line) => sum + line.pounds, 0));
  const built = lines.map((line) => ({
    key: line.key,
    pounds: round4(line.pounds),
    percent: (line.pounds / totalLb) * 100,
  }));
  const drift = 100 - built.reduce((sum, line) => sum + line.percent, 0);
  built[built.length - 1].percent = round6(built[built.length - 1].percent + drift);
  const percentTotal = built.reduce((sum, line) => sum + line.percent, 0);
  if (Math.abs(percentTotal - 100) > 0.0001) {
    return { ok: false, error: "The weights could not be turned into a 100% formula." };
  }
  return { ok: true, totalLb, lines: built };
}

export function scaleToPounds(
  lines: { key: string; percent: number }[],
  targetLb: number,
): { key: string; pounds: number }[] {
  return lines.map((line) => ({ key: line.key, pounds: round4((targetLb * line.percent) / 100) }));
}

export function contentsWeightLb(input: {
  form: ProductFormName;
  gallons?: number | null;
  netLb?: number | null;
  specificGravity?: number | null;
}): number | null {
  if (input.form === "POWDER") {
    return input.netLb != null && input.netLb > 0 ? input.netLb : null;
  }
  if (!(input.specificGravity != null && input.specificGravity > 0)) return null;
  if (!(input.gallons != null && input.gallons > 0)) return null;
  return round4(input.gallons * input.specificGravity * WATER_LB_PER_GALLON);
}

export function qtyPerUnit(input: {
  basis: PackBasisName;
  qty: number;
  unitsPerCase: number;
  casesPerPallet: number;
}): number | null {
  if (!(input.qty > 0)) return null;
  if (input.basis === "UNIT") return input.qty;
  if (!(input.unitsPerCase > 0)) return null;
  if (input.basis === "CASE") return input.qty / input.unitsPerCase;
  if (!(input.casesPerPallet > 0)) return null;
  return input.qty / (input.unitsPerCase * input.casesPerPallet);
}

export type CostedPackage = {
  contentsLb: number;
  contentsCost: number;
  packagingCost: number;
  laborCost: number;
  perUnit: number;
  perCase: number;
  perPallet: number;
  perLb: number;
  perKg: number;
  perGal: number | null;
};

/**
 * Full packaged cost. If the formula or any packaging item has no cost, this returns an error
 * and no dollar figures. A partial total is never returned.
 */
export function packagedCost(input: {
  contentsCostPerLb: number | null;
  contentsLb: number;
  gallons: number | null;
  unitsPerCase: number;
  casesPerPallet: number;
  laborPerUnit: number;
  packaging: { name: string; basis: PackBasisName; qty: number; unitCost: number | null }[];
}): { ok: true; cost: CostedPackage } | { ok: false; error: string } {
  if (!(input.contentsLb > 0)) return { ok: false, error: "This package has no contents weight. Set the specific gravity for a liquid." };
  if (input.contentsCostPerLb == null || !(input.contentsCostPerLb > 0)) {
    return { ok: false, error: "The formula cost cannot be used until every ingredient, including sub-recipes, has a real cost." };
  }
  if (!(input.unitsPerCase > 0) || !(input.casesPerPallet > 0)) {
    return { ok: false, error: "Enter how many units are in a case and how many cases are on a pallet." };
  }
  if (input.laborPerUnit < 0) return { ok: false, error: "Labor cannot be negative." };
  if (input.packaging.length === 0) {
    return { ok: false, error: "This package has no packaging bill of materials yet, so a full cost is not shown." };
  }
  let packagingCost = 0;
  for (const line of input.packaging) {
    if (line.unitCost == null || !(line.unitCost > 0)) {
      return { ok: false, error: `${line.name} has no real cost, so this package cannot be costed.` };
    }
    const each = qtyPerUnit({
      basis: line.basis,
      qty: line.qty,
      unitsPerCase: input.unitsPerCase,
      casesPerPallet: input.casesPerPallet,
    });
    if (each == null) return { ok: false, error: `${line.name} could not be split across the case or pallet.` };
    packagingCost += each * line.unitCost;
  }
  const contentsCost = input.contentsLb * input.contentsCostPerLb;
  const laborCost = input.laborPerUnit;
  const perUnit = contentsCost + packagingCost + laborCost;
  const perCase = perUnit * input.unitsPerCase;
  const perPallet = perCase * input.casesPerPallet;
  return {
    ok: true,
    cost: {
      contentsLb: input.contentsLb,
      contentsCost: round6(contentsCost),
      packagingCost: round6(packagingCost),
      laborCost: round6(laborCost),
      perUnit: round6(perUnit),
      perCase: round6(perCase),
      perPallet: round6(perPallet),
      perLb: round6(perUnit / input.contentsLb),
      perKg: round6((perUnit / input.contentsLb) * LB_PER_KG),
      perGal: input.gallons && input.gallons > 0 ? round6(perUnit / input.gallons) : null,
    },
  };
}
