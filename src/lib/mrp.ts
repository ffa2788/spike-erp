export type MrpKind = "RAW" | "FINISHED" | "PACKAGING" | "UTILITY";
export type ChannelCode = "S" | "A" | "W";
export type ExceptionKind = "LATE" | "EXPEDITE" | "CANCEL";

export type MrpItem = {
  id: string;
  name: string;
  unit: string;
  kind: MrpKind;
  leadTimeDays: number;
  reorderPoint: number;
  safetyQty: number;
  maxQty: number;
  moq: number;
  multiple: number;
  onHandReleased: number;
  onHandQuarantine: number;
  make: boolean;
};

export type BomLink = { parentId: string; componentId: string; qtyPer: number };
export type DatedQty = { itemId: string; date: string; qty: number; channel?: ChannelCode; source?: string };
export type OpenSupply = { itemId: string; date: string; qty: number };

export type PlannedOrder = {
  itemId: string;
  kind: "PURCHASE" | "PRODUCTION";
  qty: number;
  dueOn: string;
  orderOn: string;
  exception: ExceptionKind | "NONE";
  note: string;
};

export type MrpException = { itemId: string; kind: ExceptionKind; qty: number; note: string };

const HORIZON = 12;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekIndex(asOf: string, date: string): number {
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const when = Date.parse(`${date}T00:00:00Z`);
  return Math.floor((when - start) / (7 * 86400000));
}

export function orderQty(need: number, moq: number, multiple: number): number {
  if (!(need > 0)) return 0;
  let qty = need;
  if (moq > 0 && qty < moq) qty = moq;
  if (multiple > 1) {
    qty = Math.ceil(qty / multiple - 1e-9) * multiple;
  }
  return round4(qty);
}

export function channelOf(channel: string): ChannelCode {
  if (channel === "AMAZON") return "A";
  if (channel === "WALMART") return "W";
  return "S";
}

/** History fills a weekly rate. A manual forecast for that item, channel, and week replaces it. */
export function independentDemand(input: {
  asOf: string;
  orders: DatedQty[];
  history: DatedQty[];
  manual: DatedQty[];
  historyWeeks?: number;
}): DatedQty[] {
  const lookback = input.historyWeeks ?? 12;
  const historyStart = addDaysIso(input.asOf, -lookback * 7);
  const rates = new Map<string, number>();
  for (const row of input.history) {
    if (row.date < historyStart || row.date > input.asOf || !(row.qty > 0)) continue;
    const key = `${row.itemId}|${row.channel ?? "S"}`;
    rates.set(key, (rates.get(key) ?? 0) + row.qty);
  }
  const demand: DatedQty[] = input.orders
    .filter((row) => row.qty > 0)
    .map((row) => ({ ...row, date: row.date < input.asOf ? input.asOf : row.date, source: "ORDER" }));
  const manualKeys = new Set(input.manual.filter((row) => row.qty > 0).map((row) => `${row.itemId}|${row.channel ?? "S"}|${weekIndex(input.asOf, row.date)}`));
  for (const row of input.manual) {
    if (row.qty > 0) demand.push({ ...row, source: "FORECAST" });
  }
  for (const [key, total] of rates) {
    const [itemId, channel] = key.split("|");
    const perWeek = round4(total / lookback);
    if (!(perWeek > 0)) continue;
    for (let week = 0; week < HORIZON; week += 1) {
      const bucket = `${itemId}|${channel}|${week}`;
      if (manualKeys.has(bucket)) continue;
      demand.push({
        itemId,
        channel: channel as ChannelCode,
        date: addDaysIso(input.asOf, week * 7),
        qty: perWeek,
        source: "HISTORY",
      });
    }
  }
  return demand;
}

function bucket(asOf: string, date: string): number {
  const week = weekIndex(asOf, date);
  if (week < 0) return 0;
  if (week >= HORIZON) return HORIZON - 1;
  return week;
}

export function explodeDemand(input: {
  asOf: string;
  items: MrpItem[];
  bom: BomLink[];
  independent: DatedQty[];
}): { gross: Map<string, number[]>; error: string | null } {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const gross = new Map<string, number[]>();
  const ensure = (id: string) => {
    if (!gross.has(id)) gross.set(id, Array(HORIZON).fill(0));
    return gross.get(id)!;
  };
  for (const row of input.independent) {
    ensure(row.itemId)[bucket(input.asOf, row.date)] += row.qty;
  }
  const children = new Map<string, BomLink[]>();
  for (const link of input.bom) {
    const list = children.get(link.parentId) ?? [];
    list.push(link);
    children.set(link.parentId, list);
  }
  const explodedQty = new Map<string, number[]>();
  for (let pass = 0; pass < input.items.length + 2; pass += 1) {
    let changed = false;
    for (const [parentId, links] of children) {
      const weeks = ensure(parentId);
      const done = explodedQty.get(parentId) ?? Array(HORIZON).fill(0);
      explodedQty.set(parentId, done);
      const lead = byId.get(parentId)?.leadTimeDays ?? 0;
      for (let week = 0; week < HORIZON; week += 1) {
        const delta = round4(weeks[week] - done[week]);
        if (!(delta > 0)) continue;
        done[week] = round4(done[week] + delta);
        changed = true;
        const componentWeek = bucket(input.asOf, addDaysIso(addDaysIso(input.asOf, week * 7), -lead));
        for (const link of links) {
          if (!(link.qtyPer > 0)) continue;
          const componentWeeks = ensure(link.componentId);
          componentWeeks[componentWeek] = round4(componentWeeks[componentWeek] + delta * link.qtyPer);
        }
      }
    }
    if (!changed) break;
    if (pass === input.items.length + 1) return { gross, error: "A formula loops back on itself, so the plan stopped." };
  }
  for (const weeks of gross.values()) {
    for (let i = 0; i < weeks.length; i += 1) weeks[i] = round4(weeks[i]);
  }
  return { gross, error: null };
}

export function runMrp(input: {
  asOf: string;
  items: MrpItem[];
  bom: BomLink[];
  independent: DatedQty[];
  openSupply: OpenSupply[];
}): { planned: PlannedOrder[]; exceptions: MrpException[]; gross: Map<string, number[]>; error: string | null } {
  const exploded = explodeDemand(input);
  if (exploded.error) return { planned: [], exceptions: [], gross: exploded.gross, error: exploded.error };
  const planned: PlannedOrder[] = [];
  const exceptions: MrpException[] = [];
  for (const item of input.items) {
    if (item.kind === "UTILITY") continue;
    const weeks = exploded.gross.get(item.id) ?? Array(HORIZON).fill(0);
    const totalGross = weeks.reduce((sum, qty) => sum + qty, 0);
    const supplies = input.openSupply.filter((row) => row.itemId === item.id && row.qty > 0);
    const receipts = Array(HORIZON).fill(0);
    let openQty = 0;
    for (const supply of supplies) {
      receipts[bucket(input.asOf, supply.date)] += supply.qty;
      openQty += supply.qty;
    }
    let available = item.onHandReleased;
    const target = Math.max(item.reorderPoint, item.safetyQty);
    for (let week = 0; week < HORIZON; week += 1) {
      const before = available + receipts[week];
      const end = before - weeks[week];
      if (end < target - 1e-9) {
        let need = target - end;
        if (item.maxQty > 0) {
          const room = item.maxQty - before;
          if (room <= 0 && weeks[week] <= before - target) need = 0;
          else if (room > 0) need = Math.min(need, Math.max(room, weeks[week] - Math.max(0, before)));
        }
        const qty = orderQty(need, item.moq, item.multiple);
        if (qty > 0) {
          const dueOn = addDaysIso(input.asOf, week * 7);
          const orderOn = addDaysIso(dueOn, -(item.leadTimeDays || 0));
          let exception: PlannedOrder["exception"] = "NONE";
          let note = item.make ? "Plan a batch." : "Plan a purchase.";
          if (orderOn < input.asOf) {
            exception = week === 0 ? "LATE" : "EXPEDITE";
            note = exception === "LATE"
              ? "This is already late. Place it now."
              : "Normal lead time misses this date. Expedite it.";
          }
          planned.push({ itemId: item.id, kind: item.make ? "PRODUCTION" : "PURCHASE", qty, dueOn, orderOn, exception, note });
          if (exception !== "NONE") exceptions.push({ itemId: item.id, kind: exception, qty, note });
          receipts[week] += qty;
          available = before + qty - weeks[week];
          continue;
        }
      }
      available = end;
    }
    const surplus = round4(item.onHandReleased + openQty - totalGross - target);
    if (surplus > 0 && openQty > 0) {
      const note = `Open supply is ${round4(surplus)} ${item.unit} above what this horizon needs. Consider cancelling the extra.`;
      exceptions.push({ itemId: item.id, kind: "CANCEL", qty: surplus, note });
    }
  }
  return { planned, exceptions, gross: exploded.gross, error: null };
}
