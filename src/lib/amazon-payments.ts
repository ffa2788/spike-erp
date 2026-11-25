import { csvTable } from "./csv";
import { parseDateInput, parseLooseDate } from "./dates";
import { CODES } from "./chart";
import type { DraftLine } from "./journals";

export const PAYMENT_HEADERS = [
  "date/time",
  "settlement id",
  "type",
  "order id",
  "sku",
  "description",
  "quantity",
  "marketplace",
  "account type",
  "fulfillment",
  "order city",
  "order state",
  "order postal",
  "tax collection model",
  "product sales",
  "product sales tax",
  "shipping credits",
  "shipping credits tax",
  "gift wrap credits",
  "giftwrap credits tax",
  "Regulatory Fee",
  "Tax On Regulatory Fee",
  "promotional rebates",
  "promotional rebates tax",
  "marketplace withheld tax",
  "selling fees",
  "fba fees",
  "other transaction fees",
  "other",
  "total",
  "Transaction Status",
  "Transaction Release Date",
] as const;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export type PaymentRow = {
  dateTime: string;
  day: string;
  settlementId: string;
  type: string;
  orderId: string;
  sku: string;
  description: string;
  qty: number;
  fulfillment: string;
  channel: "FBA" | "FBM" | "";
  productSalesCents: number;
  sellingFeeCents: number;
  fbaFeeCents: number;
  otherTransactionFeeCents: number;
  otherCents: number;
  promotionalRebatesCents: number;
  totalCents: number;
};

export type StoredPayment = Omit<PaymentRow, "channel">;

export type SkuFeeRollup = {
  sku: string;
  orderUnits: number;
  refundUnits: number;
  netUnits: number;
  orderSalesCents: number;
  refundSalesCents: number;
  productSalesCents: number;
  avgSellingFeePerUnitCents: number | null;
  avgFbaFeePerUnitCents: number | null;
  shippingCents: number;
  serviceCents: number;
  storageCents: number;
  otherAllocatedCents: number;
  feeExpenseCents: number;
};

export function parseAmazonMoney(value: string): number {
  const raw = value.trim();
  if (!raw || raw === "--") return 0;
  const negative = raw.includes("-") || /^\(.*\)$/.test(raw);
  const digits = raw.replace(/[()$,\s]/g, "").replace(/^-/, "").replace(/-$/, "");
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return 0;
  const cents = Math.round(amount * 100);
  return negative ? -cents : cents;
}

export function paymentDay(value: string): string {
  const trimmed = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso && parseDateInput(iso[1])) return iso[1];
  const named = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(trimmed);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (month) {
      const candidate = `${named[3]}-${String(month).padStart(2, "0")}-${String(named[2]).padStart(2, "0")}`;
      if (parseDateInput(candidate)) return candidate;
    }
  }
  return parseLooseDate(trimmed) ?? "";
}

export function readAmazonMoneyFile(text: string): { rows: PaymentRow[]; error: string | null; kind: "payments" | "settlement" } {
  const sample = text.replace(/^\uFEFF/, "").slice(0, 800).toLowerCase();
  if (sample.includes("amount-type") || sample.includes("settlement-id\t")) {
    const parsed = parseSettlementFlatFile(text);
    return { ...parsed, kind: "settlement" };
  }
  const parsed = parsePaymentsReport(text);
  return { ...parsed, kind: "payments" };
}

/** Amazon's settlement flat file v2: one amount per row, tab-separated. */
export function parseSettlementFlatFile(text: string): { rows: PaymentRow[]; error: string | null } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { rows: [], error: "The settlement file needs a header and at least one amount." };
  const headers = lines[0].split("\t").map((cell) => cell.trim().toLowerCase());
  const atIndex = (name: string) => headers.indexOf(name);
  if (atIndex("settlement-id") < 0 || atIndex("amount-type") < 0) {
    return { rows: [], error: "The settlement file needs settlement-id and amount-type columns." };
  }
  const cell = (row: string[], name: string) => {
    const index = atIndex(name);
    return index >= 0 ? (row[index] ?? "").trim() : "";
  };
  const groups = new Map<string, PaymentRow>();
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const settlementId = cell(cols, "settlement-id");
    const transaction = cell(cols, "transaction-type");
    const orderId = cell(cols, "order-id");
    const sku = cell(cols, "sku");
    const amountType = cell(cols, "amount-type").toLowerCase();
    const amountDesc = cell(cols, "amount-description");
    const amount = parseAmazonMoney(cell(cols, "amount"));
    const posted = cell(cols, "posted-date-time") || cell(cols, "posted-date") || cell(cols, "deposit-date");
    const qty = Number(cell(cols, "quantity-purchased").replace(/,/g, "")) || 0;
    const fulfillmentId = cell(cols, "fulfillment-id");
    const fulfillment = fulfillmentId === "AFN" ? "Amazon" : fulfillmentId === "MFN" ? "Merchant" : fulfillmentId;
    if (!settlementId && !transaction && amount === 0) continue;
    const type = settlementType(transaction, amountType);
    const key = [settlementId, type, orderId, sku, cell(cols, "order-item-code"), posted.slice(0, 19)].join("|");
    const current = groups.get(key) ?? {
      dateTime: posted,
      day: /^\d{4}-\d{2}-\d{2}/.test(posted) ? posted.slice(0, 10) : paymentDay(posted),
      settlementId,
      type,
      orderId,
      sku,
      description: amountDesc || transaction,
      qty,
      fulfillment,
      channel: channelOf(fulfillment),
      productSalesCents: 0,
      sellingFeeCents: 0,
      fbaFeeCents: 0,
      otherTransactionFeeCents: 0,
      otherCents: 0,
      promotionalRebatesCents: 0,
      totalCents: 0,
    };
    if (qty > current.qty) current.qty = qty;
    const desc = `${amountType} ${amountDesc}`.toLowerCase();
    if (type === "Transfer") current.totalCents += amount;
    else if (desc.includes("principal") || (amountType.includes("price") && !desc.includes("tax"))) current.productSalesCents += amount;
    else if (desc.includes("fba")) current.fbaFeeCents += amount;
    else if (amountType.includes("fee") || desc.includes("commission")) current.sellingFeeCents += amount;
    else if (amountType.includes("promotion")) current.promotionalRebatesCents += amount;
    else current.otherCents += amount;
    if (type !== "Transfer") current.totalCents += amount;
    groups.set(key, current);
  }
  return { rows: [...groups.values()], error: null };
}

function settlementType(transaction: string, amountType: string): string {
  const text = `${transaction} ${amountType}`.toLowerCase();
  if (text.includes("transfer") || text.includes("deposit")) return "Transfer";
  if (text.includes("refund") || text.includes("chargeback")) return text.includes("chargeback") ? "Chargeback Refund" : "Refund";
  if (text.includes("reimburse") || text.includes("adjustment")) return "Adjustment";
  if (text.includes("service")) return "Service Fee";
  if (text.includes("storage") || text.includes("inventory fee")) return "FBA Inventory Fee";
  return "Order";
}

function isDateTimeHeader(cell: string): boolean {
  return cell.trim().toLowerCase() === "date/time";
}

export function parsePaymentsReport(text: string): { rows: PaymentRow[]; error: string | null } {
  const table = csvTable(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return { rows: [], error: "The payments report is empty." };
  const headerIndex = table.findIndex((row) => row.some((cell) => isDateTimeHeader(cell)));
  if (headerIndex < 0) return { rows: [], error: "The payments report needs a header row with a date/time column." };
  const headers = table[headerIndex].map((cell) => cell.trim().toLowerCase());
  const at = (row: string[], name: string) => {
    const index = headers.indexOf(name.toLowerCase());
    return index >= 0 ? (row[index] ?? "").trim() : "";
  };
  const body = table.slice(headerIndex + 1);
  const rows = body.flatMap((row) => {
    const type = at(row, "type");
    const dateTime = at(row, "date/time");
    if (!type && !dateTime) return [];
    const fulfillment = at(row, "fulfillment");
    const kept: PaymentRow = {
      dateTime,
      day: paymentDay(dateTime),
      settlementId: at(row, "settlement id"),
      type,
      orderId: at(row, "order id"),
      sku: at(row, "sku").trim(),
      description: at(row, "description"),
      qty: Number(at(row, "quantity").replace(/,/g, "")) || 0,
      fulfillment,
      channel: channelOf(fulfillment),
      productSalesCents: parseAmazonMoney(at(row, "product sales")),
      sellingFeeCents: parseAmazonMoney(at(row, "selling fees")),
      fbaFeeCents: parseAmazonMoney(at(row, "fba fees")),
      otherTransactionFeeCents: parseAmazonMoney(at(row, "other transaction fees")),
      otherCents: parseAmazonMoney(at(row, "other")),
      promotionalRebatesCents: parseAmazonMoney(at(row, "promotional rebates")),
      totalCents: parseAmazonMoney(at(row, "total")),
    };
    return [kept];
  });
  if (rows.length === 0) return { rows: [], error: "The payments report has a header but no payment rows could be read." };
  return { rows, error: null };
}

function channelOf(value: string): "FBA" | "FBM" | "" {
  const text = value.trim().toLowerCase();
  if (text === "amazon" || text === "afn") return "FBA";
  if (text === "merchant" || text === "mfn") return "FBM";
  return "";
}

export function paymentFingerprint(row: PaymentRow): string {
  return [row.dateTime, row.settlementId, row.type, row.orderId, row.sku, row.description, row.qty, row.totalCents].join("|");
}

export function storedPayment(row: PaymentRow): StoredPayment {
  return {
    dateTime: row.dateTime,
    day: row.day,
    settlementId: row.settlementId,
    type: row.type,
    orderId: row.orderId,
    sku: row.sku,
    description: row.description,
    qty: row.qty,
    fulfillment: row.fulfillment,
    productSalesCents: row.productSalesCents,
    sellingFeeCents: row.sellingFeeCents,
    fbaFeeCents: row.fbaFeeCents,
    otherTransactionFeeCents: row.otherTransactionFeeCents,
    otherCents: row.otherCents,
    promotionalRebatesCents: row.promotionalRebatesCents,
    totalCents: row.totalCents,
  };
}

export function dedupePayments(rows: PaymentRow[]): { kept: PaymentRow[]; duplicates: number } {
  const seen = new Set<string>();
  const kept: PaymentRow[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = paymentFingerprint(row);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    kept.push(row);
  }
  return { kept, duplicates };
}

const FEE_TYPES = new Set(["shipping services", "service fee", "fba inventory fee", "fba transaction fees", "adjustment"]);
const REFUND_TYPES = new Set(["refund", "chargeback refund"]);

/** The fee, refund, and deposit totals a payments file would post. No rows are written. */
export function paymentImportTotals(rows: PaymentRow[]): { feeCents: number; refunds: number; reimbursements: number; transferCents: number; transfers: number } {
  let feeCents = 0;
  let refunds = 0;
  let reimbursements = 0;
  let transferCents = 0;
  let transfers = 0;
  for (const row of rows) {
    const type = row.type.trim().toLowerCase();
    if (type === "transfer") {
      transfers += 1;
      transferCents += -row.totalCents;
      continue;
    }
    if (type === "order") continue;
    const effect = row.totalCents !== 0 ? row.totalCents : row.sellingFeeCents + row.fbaFeeCents + row.otherTransactionFeeCents + row.otherCents + row.promotionalRebatesCents + row.productSalesCents;
    if (REFUND_TYPES.has(type)) refunds += 1;
    else if (type === "adjustment" && effect > 0) reimbursements += 1;
    else if (FEE_TYPES.has(type)) feeCents += Math.abs(effect);
  }
  return { feeCents, refunds, reimbursements, transferCents, transfers };
}

function feeParts(row: PaymentRow): number {
  return row.sellingFeeCents + row.fbaFeeCents + row.otherTransactionFeeCents + row.otherCents + row.promotionalRebatesCents;
}

function rowEffect(row: PaymentRow): number {
  if (row.totalCents !== 0) return row.totalCents;
  return feeParts(row) + row.productSalesCents;
}

function allocateCost(cost: number, weights: { sku: string; weight: number }[]): Map<string, number> {
  const positive = weights.filter((row) => row.weight > 0).sort((a, b) => a.sku.localeCompare(b.sku));
  const out = new Map<string, number>();
  if (cost === 0 || positive.length === 0) return out;
  const total = positive.reduce((sum, row) => sum + row.weight, 0);
  let used = 0;
  positive.forEach((row, index) => {
    const share = index === positive.length - 1 ? cost - used : Math.round((cost * row.weight) / total);
    used += share;
    out.set(row.sku, (out.get(row.sku) ?? 0) + share);
  });
  return out;
}

type Bucket = {
  orderUnits: number;
  refundUnits: number;
  orderSalesCents: number;
  refundSalesCents: number;
  orderSellingFeeCents: number;
  orderFbaFeeCents: number;
  signedFees: number;
  channel: "FBA" | "FBM" | "";
  shippingCents: number;
  serviceCents: number;
  storageCents: number;
  otherAllocatedCents: number;
};

function emptyBucket(): Bucket {
  return {
    orderUnits: 0,
    refundUnits: 0,
    orderSalesCents: 0,
    refundSalesCents: 0,
    orderSellingFeeCents: 0,
    orderFbaFeeCents: 0,
    signedFees: 0,
    channel: "",
    shippingCents: 0,
    serviceCents: 0,
    storageCents: 0,
    otherAllocatedCents: 0,
  };
}

export function rollupPaymentFees(rows: PaymentRow[]): SkuFeeRollup[] {
  const buckets = new Map<string, Bucket>();
  const orderSales = new Map<string, Map<string, number>>();
  const shipping: PaymentRow[] = [];
  const service: PaymentRow[] = [];
  const storage: PaymentRow[] = [];
  const adjustments: PaymentRow[] = [];
  const fbaTxn: PaymentRow[] = [];
  const bucket = (sku: string) => {
    const found = buckets.get(sku) ?? emptyBucket();
    buckets.set(sku, found);
    return found;
  };
  for (const row of rows) {
    const type = row.type.trim().toLowerCase();
    if (type === "transfer") continue;
    const sku = row.sku.trim();
    if (type === "order" && sku) {
      const item = bucket(sku);
      item.orderUnits += row.qty;
      item.orderSalesCents += row.productSalesCents;
      item.orderSellingFeeCents += row.sellingFeeCents;
      item.orderFbaFeeCents += row.fbaFeeCents;
      item.signedFees += feeParts(row);
      if (row.channel) item.channel = row.channel;
      const bySku = orderSales.get(row.orderId) ?? new Map<string, number>();
      bySku.set(sku, (bySku.get(sku) ?? 0) + row.productSalesCents);
      orderSales.set(row.orderId, bySku);
    } else if ((type === "refund" || type === "chargeback refund") && sku) {
      const item = bucket(sku);
      item.refundUnits += row.qty;
      item.refundSalesCents += row.productSalesCents;
      item.signedFees += feeParts(row);
    } else if (sku && (type === "adjustment" || type === "fba transaction fees")) {
      const item = bucket(sku);
      const direct = feeParts(row);
      item.signedFees += direct !== 0 ? direct : row.totalCents;
    } else if (type === "shipping services") shipping.push(row);
    else if (type === "service fee") service.push(row);
    else if (type === "fba inventory fee") storage.push(row);
    else if (type === "adjustment") adjustments.push(row);
    else if (type === "fba transaction fees") fbaTxn.push(row);
    else if (sku) {
      bucket(sku).signedFees += feeParts(row) || row.totalCents;
    }
  }
  const salesWeight = () =>
    [...buckets.entries()].map(([sku, item]) => ({ sku, weight: item.orderSalesCents }));
  const fbaWeight = () =>
    [...buckets.entries()].filter(([, item]) => item.channel === "FBA").map(([sku, item]) => ({ sku, weight: item.orderSalesCents }));
  const fbmWeight = () =>
    [...buckets.entries()].filter(([, item]) => item.channel === "FBM").map(([sku, item]) => ({ sku, weight: item.orderSalesCents }));
  const add = (shares: Map<string, number>, field: "shippingCents" | "serviceCents" | "storageCents" | "otherAllocatedCents") => {
    for (const [sku, cents] of shares) {
      const item = bucket(sku);
      item[field] += cents;
    }
  };
  for (const row of shipping) {
    const cost = -rowEffect(row);
    const onOrder = [...(orderSales.get(row.orderId)?.entries() ?? [])].map(([sku, weight]) => ({ sku, weight }));
    const shares = allocateCost(cost, onOrder.length ? onOrder : fbmWeight().length ? fbmWeight() : salesWeight());
    if (shares.size === 0 && cost !== 0) add(allocateCost(cost, [{ sku: row.sku || "(no order)", weight: 1 }]), "shippingCents");
    else add(shares, "shippingCents");
  }
  add(allocateCost(service.reduce((sum, row) => sum - rowEffect(row), 0), salesWeight()), "serviceCents");
  add(allocateCost(storage.reduce((sum, row) => sum - rowEffect(row), 0), fbaWeight().length ? fbaWeight() : salesWeight()), "storageCents");
  add(allocateCost(adjustments.reduce((sum, row) => sum - rowEffect(row), 0), salesWeight()), "otherAllocatedCents");
  add(allocateCost(fbaTxn.reduce((sum, row) => sum - rowEffect(row), 0), fbaWeight().length ? fbaWeight() : salesWeight()), "otherAllocatedCents");
  return [...buckets.entries()]
    .map(([sku, item]) => {
      const feeExpenseCents = -item.signedFees + item.shippingCents + item.serviceCents + item.storageCents + item.otherAllocatedCents;
      return {
        sku,
        orderUnits: item.orderUnits,
        refundUnits: item.refundUnits,
        netUnits: item.orderUnits - item.refundUnits,
        orderSalesCents: item.orderSalesCents,
        refundSalesCents: item.refundSalesCents,
        productSalesCents: item.orderSalesCents + item.refundSalesCents,
        avgSellingFeePerUnitCents: item.orderUnits > 0 ? Math.round(-item.orderSellingFeeCents / item.orderUnits) || 0 : null,
        avgFbaFeePerUnitCents: item.orderUnits > 0 ? Math.round(-item.orderFbaFeeCents / item.orderUnits) || 0 : null,
        shippingCents: item.shippingCents,
        serviceCents: item.serviceCents,
        storageCents: item.storageCents,
        otherAllocatedCents: item.otherAllocatedCents,
        feeExpenseCents,
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

export function netMarginCents(rollup: SkuFeeRollup, unitCostCents: number | null): { costCents: number | null; marginCents: number | null } {
  if (unitCostCents == null) return { costCents: null, marginCents: null };
  const costCents = unitCostCents * rollup.netUnits;
  return { costCents, marginCents: rollup.productSalesCents - rollup.feeExpenseCents - costCents };
}

function feePlug(lines: DraftLine[]): DraftLine[] {
  const kept = lines.filter((line) => line.debitCents > 0 || line.creditCents > 0);
  const debit = kept.reduce((sum, line) => sum + line.debitCents, 0);
  const credit = kept.reduce((sum, line) => sum + line.creditCents, 0);
  if (debit === credit) return kept;
  if (debit > credit) kept.push({ accountCode: CODES.amazonFees, debitCents: 0, creditCents: debit - credit, memo: "Amazon fees" });
  else kept.push({ accountCode: CODES.amazonFees, debitCents: credit - debit, creditCents: 0, memo: "Amazon fees" });
  return kept;
}

export function settlementJournal(input: { invoiceBalanceCents: number; orderTotalCents: number }): DraftLine[] | null {
  const balance = input.invoiceBalanceCents;
  const net = input.orderTotalCents;
  if (balance <= 0) return null;
  const lines: DraftLine[] = [{ accountCode: CODES.ar, debitCents: 0, creditCents: balance, memo: "Amazon order settled" }];
  if (net > 0) lines.push({ accountCode: CODES.amazonClearing, debitCents: net, creditCents: 0, memo: "Amazon holds this order" });
  else if (net < 0) lines.push({ accountCode: CODES.amazonClearing, debitCents: 0, creditCents: -net, memo: "Amazon holds this order" });
  const fee = balance - net;
  if (fee > 0) lines.push({ accountCode: CODES.amazonFees, debitCents: fee, creditCents: 0, memo: "Amazon fees on the order" });
  else if (fee < 0) lines.push({ accountCode: CODES.amazonFees, debitCents: 0, creditCents: -fee, memo: "Amazon fees on the order" });
  return lines;
}

export function transferJournal(totalCents: number): DraftLine[] | null {
  if (totalCents === 0) return null;
  if (totalCents < 0) {
    return [
      { accountCode: CODES.cash, debitCents: -totalCents, creditCents: 0, memo: "Amazon payout" },
      { accountCode: CODES.amazonClearing, debitCents: 0, creditCents: -totalCents, memo: "Amazon payout" },
    ];
  }
  return [
    { accountCode: CODES.amazonClearing, debitCents: totalCents, creditCents: 0, memo: "Amazon pulled funds" },
    { accountCode: CODES.cash, debitCents: 0, creditCents: totalCents, memo: "Amazon pulled funds" },
  ];
}

/** Books each Amazon fee to its own account so the month is right and year-end is not one lump. */
export function amazonFeeAccount(type: string, description = ""): string {
  const text = `${type} ${description}`.toLowerCase();
  if (text.includes("shipping service") || text.includes("shipping label")) return CODES.amazonShipping;
  if (text.includes("subscription")) return CODES.amazonSubscription;
  if (text.includes("storage") || text.includes("inventory fee")) return CODES.amazonStorage;
  if (text.includes("advert") || text.includes("sponsored")) return CODES.amazonAds;
  if (text.includes("fba")) return CODES.amazonFbaFee;
  if (text.includes("selling") || text.includes("referral") || text.includes("commission")) return CODES.amazonReferral;
  return CODES.amazonFees;
}

export function feeJournal(totalCents: number, accountCode: string = CODES.amazonFees, memo = "Amazon fee"): DraftLine[] | null {
  if (totalCents === 0) return null;
  if (totalCents < 0) {
    return [
      { accountCode, debitCents: -totalCents, creditCents: 0, memo },
      { accountCode: CODES.amazonClearing, debitCents: 0, creditCents: -totalCents, memo },
    ];
  }
  return [
    { accountCode: CODES.amazonClearing, debitCents: totalCents, creditCents: 0, memo },
    { accountCode, debitCents: 0, creditCents: totalCents, memo },
  ];
}

export function settlementNetsToDeposit(rows: PaymentRow[]): { settlementId: string; activityCents: number; depositCents: number; differenceCents: number }[] {
  const groups = new Map<string, PaymentRow[]>();
  for (const row of rows) {
    const list = groups.get(row.settlementId || "(none)") ?? [];
    list.push(row);
    groups.set(row.settlementId || "(none)", list);
  }
  return [...groups.entries()].map(([settlementId, lines]) => {
    const depositCents = lines.filter((line) => line.type.trim().toLowerCase() === "transfer").reduce((sum, line) => sum - line.totalCents, 0);
    const activityCents = lines.filter((line) => line.type.trim().toLowerCase() !== "transfer").reduce((sum, line) => sum + line.totalCents, 0);
    return { settlementId, activityCents, depositCents, differenceCents: activityCents - depositCents };
  });
}

export function feeRowJournal(totalCents: number): DraftLine[] | null {
  return feeJournal(totalCents);
}

export function refundJournal(row: PaymentRow): DraftLine[] | null {
  const lines: DraftLine[] = [];
  if (row.productSalesCents < 0) lines.push({ accountCode: CODES.sales, debitCents: -row.productSalesCents, creditCents: 0, memo: "Amazon refund" });
  else if (row.productSalesCents > 0) lines.push({ accountCode: CODES.sales, debitCents: 0, creditCents: row.productSalesCents, memo: "Amazon refund" });
  const fees = feeParts(row);
  if (fees > 0) lines.push({ accountCode: CODES.amazonFees, debitCents: 0, creditCents: fees, memo: "Amazon returned a fee" });
  else if (fees < 0) lines.push({ accountCode: CODES.amazonFees, debitCents: -fees, creditCents: 0, memo: "Amazon fee on a refund" });
  if (row.totalCents < 0) lines.push({ accountCode: CODES.amazonClearing, debitCents: 0, creditCents: -row.totalCents, memo: "Amazon balance" });
  else if (row.totalCents > 0) lines.push({ accountCode: CODES.amazonClearing, debitCents: row.totalCents, creditCents: 0, memo: "Amazon balance" });
  const balanced = feePlug(lines);
  return balanced.length >= 2 ? balanced : null;
}
