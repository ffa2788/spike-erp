export type PackBasisName = "UNIT" | "CASE" | "PALLET";

export type BuyTone = "red" | "amber" | "ok";

export type BuySoon = {
  weeklyUse: number;
  weeksLeft: number | null;
  reorderPoint: number;
  suggestedQty: number;
  tone: BuyTone;
  runOut: string | null;
  thresholdWeeks: number;
};

export function roundBuy(qty: number, moq: number, multiple: number): number {
  if (!(qty > 0)) return 0;
  let buy = qty;
  if (moq > 0 && buy < moq) buy = moq;
  if (multiple > 1) buy = Math.ceil(buy / multiple - 1e-9) * multiple;
  return Math.round(buy * 10000) / 10000;
}

export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Math.round(days));
  return date.toISOString().slice(0, 10);
}

/** Weeks of cover and the buy quantity. Red means it runs out before a purchase order could arrive. */
export function buySoon(input: {
  onHand: number;
  onOrder: number;
  usedIn8Weeks: number;
  weeklyOverride: number | null;
  leadTimeWeeks: number;
  safetyWeeks: number;
  moq: number;
  multiple: number;
  asOf: string;
}): BuySoon {
  const weeklyUse = input.weeklyOverride != null && input.weeklyOverride >= 0
    ? input.weeklyOverride
    : Math.round((input.usedIn8Weeks / 8) * 10000) / 10000;
  const lead = Math.max(0, input.leadTimeWeeks);
  const safety = Math.max(0, input.safetyWeeks);
  const thresholdWeeks = lead + safety;
  const available = Math.max(0, input.onHand) + Math.max(0, input.onOrder);
  const weeksLeft = weeklyUse > 0 ? Math.round((available / weeklyUse) * 10) / 10 : null;
  const reorderPoint = Math.round(weeklyUse * thresholdWeeks * 10000) / 10000;
  const short = reorderPoint - available;
  const suggestedQty = roundBuy(short, input.moq, input.multiple);
  let tone: BuyTone = "ok";
  if (weeksLeft != null && weeksLeft < lead) tone = "red";
  else if (weeksLeft != null && weeksLeft < thresholdWeeks) tone = "amber";
  const runOut = weeksLeft == null ? null : addDaysIso(input.asOf, weeksLeft * 7);
  return { weeklyUse, weeksLeft, reorderPoint, suggestedQty, tone, runOut, thresholdWeeks };
}

export function packagingQty(input: {
  units: number;
  unitsPerCase: number;
  casesPerPallet: number;
  basis: PackBasisName;
  qty: number;
}): number {
  if (!(input.units > 0) || !(input.qty > 0)) return 0;
  if (input.basis === "UNIT") return input.units * input.qty;
  const perCase = input.unitsPerCase > 0 ? input.unitsPerCase : 1;
  if (input.basis === "CASE") return Math.ceil(input.units / perCase) * input.qty;
  const perPallet = perCase * (input.casesPerPallet > 0 ? input.casesPerPallet : 1);
  return Math.ceil(input.units / perPallet) * input.qty;
}

export function leadWeeks(leadTimeDays: number | null): number {
  if (leadTimeDays == null || leadTimeDays <= 0) return 2;
  return Math.round((leadTimeDays / 7) * 10) / 10;
}
