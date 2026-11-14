export const CODES = {
  cash: "1000",
  ar: "1100",
  invRaw: "1200",
  invFg: "1210",
  wip: "1220",
  shipped: "1230",
  ap: "2000",
  grni: "2100",
  tax: "2200",
  equity: "3000",
  obe: "3900",
  sales: "4000",
  otherIncome: "4200",
  cogs: "5000",
  ppv: "5100",
  utilityApplied: "5300",
  amazonFees: "6100",
  bankFees: "6200",
  adjustment: "6300",
} as const;

export type AccountTypeName = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "COGS" | "EXPENSE";

export const CHART: { code: string; name: string; type: AccountTypeName }[] = [
  { code: CODES.cash, name: "Cash in the bank", type: "ASSET" },
  { code: CODES.ar, name: "Money customers owe us", type: "ASSET" },
  { code: CODES.invRaw, name: "Raw material on hand", type: "ASSET" },
  { code: CODES.invFg, name: "Finished goods on hand", type: "ASSET" },
  { code: CODES.wip, name: "Batches in progress", type: "ASSET" },
  { code: CODES.shipped, name: "Shipped, not yet billed", type: "ASSET" },
  { code: CODES.ap, name: "Money we owe suppliers", type: "LIABILITY" },
  { code: CODES.grni, name: "Received, not yet billed", type: "LIABILITY" },
  { code: CODES.tax, name: "Sales tax to send the state", type: "LIABILITY" },
  { code: CODES.equity, name: "Owner's equity", type: "EQUITY" },
  { code: CODES.obe, name: "Opening balances", type: "EQUITY" },
  { code: CODES.sales, name: "Product sales", type: "INCOME" },
  { code: CODES.otherIncome, name: "Other income", type: "INCOME" },
  { code: CODES.cogs, name: "Cost of goods sold", type: "COGS" },
  { code: CODES.ppv, name: "Purchase price differences", type: "COGS" },
  { code: CODES.utilityApplied, name: "Utility cost in batches", type: "COGS" },
  { code: CODES.amazonFees, name: "Amazon fees", type: "EXPENSE" },
  { code: CODES.bankFees, name: "Bank fees", type: "EXPENSE" },
  { code: CODES.adjustment, name: "Inventory adjustments", type: "EXPENSE" },
];

export function inventoryAccount(kind: "RAW" | "FINISHED" | "UTILITY"): string | null {
  if (kind === "RAW") return CODES.invRaw;
  if (kind === "FINISHED") return CODES.invFg;
  return null;
}

export const SEQUENCES: { name: string; prefix: string; start: number }[] = [
  { name: "quote", prefix: "QT", start: 1001 },
  { name: "order", prefix: "SO", start: 1001 },
  { name: "delivery", prefix: "DN", start: 1001 },
  { name: "invoice", prefix: "INV", start: 1001 },
  { name: "receipt-pay", prefix: "PMT", start: 1001 },
  { name: "po", prefix: "PO", start: 1001 },
  { name: "receipt", prefix: "RCV", start: 1001 },
  { name: "bill", prefix: "BILL", start: 1001 },
  { name: "vpay", prefix: "VPAY", start: 1001 },
  { name: "batch", prefix: "PB", start: 1001 },
  { name: "lot", prefix: "L", start: 1001 },
  { name: "journal", prefix: "JE", start: 1001 },
];
