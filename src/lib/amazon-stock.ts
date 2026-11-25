import { fefoAllocate, type LotBalance } from "./inventory";

export type AmazonStockLine = { sku: string; productId: string; productSku: string; qty: number };

export type AmazonStockHold = {
  sku: string;
  product: string;
  needed: number;
  available: number;
  reason: string;
};

function atLocation(lots: LotBalance[], locationId: string): LotBalance[] {
  return lots.map((lot) => ({
    ...lot,
    locations: lot.locations.filter((row) => row.locationId === locationId).map((row) => ({ ...row, shippable: true })),
  }));
}

function applyPicks(lots: LotBalance[], picks: { lotId: string; locationId: string; qty: number }[]) {
  for (const pick of picks) {
    const lot = lots.find((item) => item.lotId === pick.lotId);
    const bin = lot?.locations.find((row) => row.locationId === pick.locationId);
    if (bin) bin.qty = Math.round((bin.qty - pick.qty) * 10000) / 10000;
  }
}

/** Lines that cannot be filled from released stock at one location. Stock is left unchanged when any line is short. */
export function orderStockHolds(lots: LotBalance[], locationId: string, asOf: string, lines: AmazonStockLine[]): AmazonStockHold[] {
  const trial = atLocation(lots, locationId);
  const holds: AmazonStockHold[] = [];
  const picks: { lotId: string; locationId: string; qty: number }[] = [];
  for (const line of lines) {
    const allocation = fefoAllocate(trial, line.productId, line.qty, asOf);
    if (!allocation.ok) {
      holds.push({
        sku: line.sku,
        product: line.productSku,
        needed: line.qty,
        available: allocation.available,
        reason: allocation.error,
      });
      continue;
    }
    picks.push(...allocation.picks);
    applyPicks(trial, allocation.picks);
  }
  if (holds.length === 0) applyPicks(lots, picks);
  return holds;
}
