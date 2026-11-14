export type QcName = "QUARANTINE" | "APPROVED" | "REJECTED";

export type LotBalance = {
  lotId: string;
  lotNumber: string;
  productId: string;
  qcStatus: QcName;
  expiresOn: string | null;
  receivedOn: string;
  unitCost: number;
  formulaVersion: number | null;
  nsfEligible: boolean;
  locations: { locationId: string; locationCode: string; shippable: boolean; qty: number }[];
};

export type StockPick = {
  lotId: string;
  lotNumber: string;
  locationId: string;
  qty: number;
  unitCost: number;
  formulaVersion: number | null;
  nsfEligible: boolean;
  qcStatus: QcName;
  expiresOn: string | null;
};

const QTY_SCALE = 10000;

export function roundQty(qty: number): number {
  return Math.round(qty * QTY_SCALE) / QTY_SCALE;
}

/** Inventory value in cents, using integer math so partial issues stay in step with the books. */
export function valueCents(qty: number, unitCost: number): number {
  const qtyUnits = Math.round(qty * QTY_SCALE);
  const costMicros = Math.round(unitCost * 1_000_000);
  return Math.round((qtyUnits * costMicros) / 100_000_000);
}

export function reliefCents(qtyBefore: number, qtyAfter: number, unitCost: number): number {
  return valueCents(qtyBefore, unitCost) - valueCents(qtyAfter, unitCost);
}

export function buildLotBalances(input: {
  lots: {
    id: string;
    lotNumber: string;
    productId: string;
    qcStatus: QcName;
    expiresOn: string | null;
    receivedOn: string;
    unitCost: number;
    formulaVersion: number | null;
    nsfEligible: boolean;
  }[];
  movements: { lotId: string; locationId: string; qty: number }[];
  locations: { id: string; code: string; shippable: boolean }[];
}): LotBalance[] {
  const locations = new Map(input.locations.map((location) => [location.id, location]));
  return input.lots.map((lot) => {
    const qtyByLocation = new Map<string, number>();
    for (const movement of input.movements) {
      if (movement.lotId !== lot.id) continue;
      qtyByLocation.set(movement.locationId, (qtyByLocation.get(movement.locationId) ?? 0) + movement.qty);
    }
    const rows = [...qtyByLocation.entries()]
      .map(([locationId, qty]) => {
        const location = locations.get(locationId);
        return {
          locationId,
          locationCode: location?.code ?? locationId,
          shippable: location?.shippable ?? false,
          qty: roundQty(qty),
        };
      })
      .filter((row) => row.qty > 0.00005)
      .sort((a, b) => a.locationCode.localeCompare(b.locationCode));
    return {
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      productId: lot.productId,
      qcStatus: lot.qcStatus,
      expiresOn: lot.expiresOn,
      receivedOn: lot.receivedOn,
      unitCost: lot.unitCost,
      formulaVersion: lot.formulaVersion,
      nsfEligible: lot.nsfEligible,
      locations: rows,
    };
  });
}

export function lotQty(lot: LotBalance): number {
  return roundQty(lot.locations.reduce((sum, row) => sum + row.qty, 0));
}

export function availablePieces(lot: LotBalance, asOf: string): { locationId: string; qty: number }[] {
  if (lot.qcStatus !== "APPROVED") return [];
  if (lot.expiresOn && lot.expiresOn < asOf) return [];
  return lot.locations.filter((row) => row.shippable && row.qty > 0.00005);
}

export function availableQty(lot: LotBalance, asOf: string): number {
  return roundQty(availablePieces(lot, asOf).reduce((sum, row) => sum + row.qty, 0));
}

export function fefoAllocate(
  lots: LotBalance[],
  productId: string,
  qtyNeeded: number,
  asOf: string,
):
  | { ok: true; picks: StockPick[]; available: number }
  | { ok: false; error: string; available: number } {
  const needed = roundQty(qtyNeeded);
  const candidates = lots
    .filter((lot) => lot.productId === productId)
    .slice()
    .sort((a, b) => {
      const expA = a.expiresOn ?? "9999-99-99";
      const expB = b.expiresOn ?? "9999-99-99";
      if (expA !== expB) return expA < expB ? -1 : 1;
      if (a.receivedOn !== b.receivedOn) return a.receivedOn < b.receivedOn ? -1 : 1;
      return a.lotNumber.localeCompare(b.lotNumber);
    });

  let available = 0;
  const picks: StockPick[] = [];
  let remaining = needed;
  for (const lot of candidates) {
    const pieces = availablePieces(lot, asOf);
    const lotAvailable = roundQty(pieces.reduce((sum, row) => sum + row.qty, 0));
    available = roundQty(available + lotAvailable);
    for (const piece of pieces) {
      if (remaining <= 0.00005) break;
      const take = roundQty(Math.min(piece.qty, remaining));
      if (take <= 0) continue;
      picks.push({
        lotId: lot.lotId,
        lotNumber: lot.lotNumber,
        locationId: piece.locationId,
        qty: take,
        unitCost: lot.unitCost,
        formulaVersion: lot.formulaVersion,
        nsfEligible: lot.nsfEligible,
        qcStatus: lot.qcStatus,
        expiresOn: lot.expiresOn,
      });
      remaining = roundQty(remaining - take);
    }
  }

  if (needed <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero.", available };
  }
  if (remaining > 0.00005) {
    return {
      ok: false,
      error: `Not enough released stock. Need ${needed}, and ${available} is ready to use.`,
      available,
    };
  }
  return { ok: true, picks, available };
}

export function stockBuckets(lots: LotBalance[], productId: string, asOf: string) {
  let available = 0;
  let quarantine = 0;
  let rejected = 0;
  let expired = 0;
  let value = 0;
  for (const lot of lots) {
    if (lot.productId !== productId) continue;
    const qty = lotQty(lot);
    value += valueCents(qty, lot.unitCost);
    if (lot.qcStatus === "REJECTED") {
      rejected = roundQty(rejected + qty);
      continue;
    }
    if (lot.qcStatus === "QUARANTINE") {
      quarantine = roundQty(quarantine + qty);
      continue;
    }
    if (lot.expiresOn && lot.expiresOn < asOf) {
      expired = roundQty(expired + qty);
      continue;
    }
    available = roundQty(available + availableQty(lot, asOf));
  }
  return { available, quarantine, rejected, expired, valueCents: value };
}
