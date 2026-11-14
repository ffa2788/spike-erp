import { addDaysIso } from "./mrp";
import type { ChannelCode } from "./mrp";

export type ScheduleSku = {
  id: string;
  sku: string;
  name: string;
  packageLabel: string;
  unit: string;
  multiple: number;
  coverDays: number;
  salesQty: number;
  windowDays: number;
  salesByChannel: Record<ChannelCode, number>;
  openOrders: number;
  amazonOpenOrders: number;
  supermarket: number;
  fbaFulfillable: number;
  fbaInbound: number;
  wip: number;
  formulaVersion: number | null;
  pullLot: string;
  materials: { id: string; name: string; requiredPerUnit: number; onHand: number; unit: string }[];
};

export type ScheduleRow = {
  id: string;
  sku: string;
  name: string;
  packageLabel: string;
  unit: string;
  daily: number;
  daysCover: number | null;
  target: number;
  supply: number;
  supermarket: number;
  fbaOnHand: number;
  wip: number;
  openOrders: number;
  suggested: number;
  fbaReplenish: number;
  fbaNote: string;
  dueOn: string;
  formulaVersion: number | null;
  pullLot: string;
  materials: { name: string; perUnit: number; onHand: number; qty: number; unit: string; short: number }[];
  shortage: boolean;
};

export function roundUpToMultiple(qty: number, multiple: number): number {
  if (!(qty > 0)) return 0;
  const step = multiple > 1 ? multiple : 1;
  return Math.ceil(qty / step - 1e-9) * step;
}

export function nextWeekdays(asOf: string, count = 5): string[] {
  const dates: string[] = [];
  let cursor = asOf;
  while (dates.length < count) {
    cursor = addDaysIso(cursor, 1);
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor);
  }
  return dates;
}

export function suggestSchedule(input: { asOf: string; skus: ScheduleSku[] }): ScheduleRow[] {
  const days = nextWeekdays(input.asOf);
  const rows = input.skus.map((sku) => {
    const windowDays = sku.windowDays > 0 ? sku.windowDays : 56;
    const daily = sku.salesQty / windowDays;
    const amazonDaily = sku.salesByChannel.A / windowDays;
    const target = daily * sku.coverDays;
    const supply = sku.supermarket + sku.fbaFulfillable + sku.fbaInbound + sku.wip;
    const raw = Math.max(0, target + sku.openOrders - supply);
    const suggested = roundUpToMultiple(raw, sku.multiple);
    const fbaShort = Math.max(0, amazonDaily * sku.coverDays + sku.amazonOpenOrders - sku.fbaFulfillable - sku.fbaInbound);
    let fbaReplenish = 0;
    let fbaNote = "FBA does not need a shipment from the supermarket.";
    if (fbaShort > 0 && sku.supermarket > 0) {
      fbaReplenish = roundUpToMultiple(Math.min(sku.supermarket, fbaShort), sku.multiple);
      if (fbaReplenish > sku.supermarket) fbaReplenish = Math.floor(sku.supermarket / (sku.multiple > 1 ? sku.multiple : 1)) * (sku.multiple > 1 ? sku.multiple : 1);
      fbaNote = "Ship this from the supermarket to FBA. It is not a new batch.";
    } else if (fbaShort > 0) {
      fbaNote = "FBA is short and the supermarket is empty. Make product before you ship to Amazon.";
    }
    const materials = sku.materials.map((material) => {
      const qty = Math.round(material.requiredPerUnit * suggested * 10000) / 10000;
      const short = Math.max(0, Math.round((qty - material.onHand) * 10000) / 10000);
      return { name: material.name, perUnit: material.requiredPerUnit, onHand: material.onHand, qty, unit: material.unit, short };
    });
    const daysCover = daily > 0 ? Math.round((supply / daily) * 10) / 10 : sku.openOrders > supply ? 0 : null;
    return {
      id: sku.id,
      sku: sku.sku,
      name: sku.name,
      packageLabel: sku.packageLabel,
      unit: sku.unit,
      daily: Math.round(daily * 10000) / 10000,
      daysCover,
      target: Math.round(target * 100) / 100,
      supply: Math.round(supply * 100) / 100,
      supermarket: sku.supermarket,
      fbaOnHand: sku.fbaFulfillable + sku.fbaInbound,
      wip: sku.wip,
      openOrders: sku.openOrders,
      suggested,
      fbaReplenish,
      fbaNote,
      dueOn: "",
      formulaVersion: sku.formulaVersion,
      pullLot: sku.pullLot,
      materials,
      shortage: materials.some((material) => material.short > 0),
    };
  });
  rows.sort((a, b) => {
    const left = a.daysCover == null ? Number.POSITIVE_INFINITY : a.daysCover;
    const right = b.daysCover == null ? Number.POSITIVE_INFINITY : b.daysCover;
    return left - right || a.sku.localeCompare(b.sku);
  });
  const working = rows.filter((row) => row.suggested > 0 || row.fbaReplenish > 0);
  working.forEach((row, index) => {
    row.dueOn = days[index % days.length];
  });
  return rows;
}
