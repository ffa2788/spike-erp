export type CoverStatus = "CRITICAL" | "LOW" | "OK";

export type Coverage = {
  daysVsUsage: number | null;
  weeksVsDemand: Record<1 | 2 | 4 | 8 | 12, number | null>;
  status: CoverStatus;
  action: string;
};

function cleanQty(qty: number): string {
  const rounded = Math.round(qty * 10000) / 10000;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function weeksCover(onHand: number, weekly: number[]): number | null {
  const total = weekly.reduce((sum, qty) => sum + qty, 0);
  if (!(total > 0)) return null;
  const average = total / weekly.length;
  if (!(average > 0)) return null;
  return Math.round((onHand / average) * 10) / 10;
}

export function coverItem(input: {
  onHand: number;
  reorderPoint: number;
  safetyQty: number;
  leadTimeDays: number;
  weeklyUsage: number;
  demandByWeek: number[];
  suggestedQty: number;
  openPoQty: number;
  unit: string;
}): Coverage {
  const daysVsUsage = input.weeklyUsage > 0 ? Math.round((input.onHand / (input.weeklyUsage / 7)) * 10) / 10 : null;
  const demand = input.demandByWeek.slice(0, 12);
  while (demand.length < 12) demand.push(0);
  const horizons = [1, 2, 4, 8, 12] as const;
  const weeksVsDemand = {
    1: weeksCover(input.onHand, demand.slice(0, 1)),
    2: weeksCover(input.onHand, demand.slice(0, 2)),
    4: weeksCover(input.onHand, demand.slice(0, 4)),
    8: weeksCover(input.onHand, demand.slice(0, 8)),
    12: weeksCover(input.onHand, demand.slice(0, 12)),
  } satisfies Coverage["weeksVsDemand"];
  const nearDemand = demand.slice(0, 4).reduce((sum, qty) => sum + qty, 0);
  let status: CoverStatus = "OK";
  if (input.onHand <= 0 && (input.weeklyUsage > 0 || nearDemand > 0)) status = "CRITICAL";
  else if (input.safetyQty > 0 && input.onHand < input.safetyQty) status = "CRITICAL";
  else if (daysVsUsage != null && daysVsUsage < 7) status = "CRITICAL";
  else if (input.reorderPoint > 0 && input.onHand < input.reorderPoint) status = "LOW";
  else if (daysVsUsage != null && input.leadTimeDays > 0 && daysVsUsage < input.leadTimeDays) status = "LOW";
  let action = "No order needed.";
  if (input.suggestedQty > 0 && input.openPoQty > 0) {
    action = `A purchase order is already open for ${cleanQty(input.openPoQty)} ${input.unit}. The plan still wants ${cleanQty(input.suggestedQty)} ${input.unit} more.`;
  } else if (input.suggestedQty > 0) {
    action = `Order ${cleanQty(input.suggestedQty)} ${input.unit}. No purchase order is open.`;
  } else if (input.openPoQty > 0) {
    action = `A purchase order is already open for ${cleanQty(input.openPoQty)} ${input.unit}.`;
  }
  void horizons;
  return { daysVsUsage, weeksVsDemand, status, action };
}
