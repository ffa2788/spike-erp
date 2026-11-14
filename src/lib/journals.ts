import { CODES } from "./chart";

export type DraftLine = {
  accountCode: string;
  debitCents: number;
  creditCents: number;
  memo?: string;
};

export type AccountTypeName = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "COGS" | "EXPENSE";

export type PostedLine = {
  accountCode: string;
  accountName: string;
  accountType: AccountTypeName;
  debitCents: number;
  creditCents: number;
  date: string;
};

export function journalProblem(lines: DraftLine[]): string | null {
  if (lines.length < 2) return "A journal entry needs at least two lines.";
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!line.accountCode) return "Every line needs an account.";
    if (!Number.isInteger(line.debitCents) || !Number.isInteger(line.creditCents)) {
      return "Journal amounts must be whole cents.";
    }
    if (line.debitCents < 0 || line.creditCents < 0) return "Amounts cannot be negative.";
    if (line.debitCents > 0 && line.creditCents > 0) return "A line cannot have both a debit and a credit.";
    if (line.debitCents === 0 && line.creditCents === 0) return "A line needs a debit or a credit.";
    debit += line.debitCents;
    credit += line.creditCents;
  }
  if (debit !== credit) {
    return `Debits ($${(debit / 100).toFixed(2)}) do not equal credits ($${(credit / 100).toFixed(2)}).`;
  }
  if (debit === 0) return "The entry is zero.";
  return null;
}

export function salesJournal(input: {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  feeCents?: number;
}): DraftLine[] {
  const fee = input.feeCents ?? 0;
  const lines: DraftLine[] = [
    {
      accountCode: CODES.ar,
      debitCents: input.totalCents - fee,
      creditCents: 0,
      memo: "Customer owes this invoice",
    },
    { accountCode: CODES.sales, debitCents: 0, creditCents: input.subtotalCents, memo: "Product sales" },
  ];
  if (fee > 0) {
    lines.push({ accountCode: CODES.amazonFees, debitCents: fee, creditCents: 0, memo: "Amazon fees" });
  }
  if (input.taxCents > 0) {
    lines.push({ accountCode: CODES.tax, debitCents: 0, creditCents: input.taxCents, memo: "Sales tax" });
  }
  return lines;
}

/** Goods leave the warehouse, but the sale is not recorded until the invoice. */
export function shipJournal(credits: { accountCode: string; cents: number }[]): DraftLine[] {
  const grouped = new Map<string, number>();
  for (const credit of credits) {
    if (credit.cents <= 0) continue;
    grouped.set(credit.accountCode, (grouped.get(credit.accountCode) ?? 0) + credit.cents);
  }
  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  const lines: DraftLine[] = [
    { accountCode: CODES.shipped, debitCents: total, creditCents: 0, memo: "Shipped, not yet billed" },
  ];
  for (const [accountCode, cents] of grouped) {
    lines.push({ accountCode, debitCents: 0, creditCents: cents, memo: "Inventory shipped" });
  }
  return lines;
}

export function cogsJournal(totalCents: number): DraftLine[] {
  if (totalCents <= 0) return [];
  return [
    { accountCode: CODES.cogs, debitCents: totalCents, creditCents: 0, memo: "Cost of goods sold" },
    { accountCode: CODES.shipped, debitCents: 0, creditCents: totalCents, memo: "Cost of goods sold" },
  ];
}

export function receiptJournal(debits: { accountCode: string; cents: number }[]): DraftLine[] {
  const grouped = new Map<string, number>();
  for (const debit of debits) {
    if (debit.cents <= 0) continue;
    grouped.set(debit.accountCode, (grouped.get(debit.accountCode) ?? 0) + debit.cents);
  }
  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  const lines: DraftLine[] = [];
  for (const [accountCode, cents] of grouped) {
    lines.push({ accountCode, debitCents: cents, creditCents: 0, memo: "Goods received" });
  }
  lines.push({
    accountCode: CODES.grni,
    debitCents: 0,
    creditCents: total,
    memo: "Waiting for the supplier bill",
  });
  return lines;
}

export function vendorBillJournal(receiptCents: number, billCents: number): DraftLine[] {
  const lines: DraftLine[] = [
    { accountCode: CODES.grni, debitCents: receiptCents, creditCents: 0, memo: "Clear goods received" },
    { accountCode: CODES.ap, debitCents: 0, creditCents: billCents, memo: "Supplier bill" },
  ];
  const difference = billCents - receiptCents;
  if (difference > 0) {
    lines.push({
      accountCode: CODES.ppv,
      debitCents: difference,
      creditCents: 0,
      memo: "Billed more than the receipt",
    });
  } else if (difference < 0) {
    lines.push({
      accountCode: CODES.ppv,
      debitCents: 0,
      creditCents: -difference,
      memo: "Billed less than the receipt",
    });
  }
  return lines;
}

export function customerPaymentJournal(amountCents: number): DraftLine[] {
  return [
    { accountCode: CODES.cash, debitCents: amountCents, creditCents: 0, memo: "Customer payment" },
    { accountCode: CODES.ar, debitCents: 0, creditCents: amountCents, memo: "Customer payment" },
  ];
}

export function vendorPaymentJournal(amountCents: number): DraftLine[] {
  return [
    { accountCode: CODES.ap, debitCents: amountCents, creditCents: 0, memo: "Supplier payment" },
    { accountCode: CODES.cash, debitCents: 0, creditCents: amountCents, memo: "Supplier payment" },
  ];
}

export function wipJournal(credits: { accountCode: string; cents: number }[]): DraftLine[] {
  const grouped = new Map<string, number>();
  for (const credit of credits) {
    if (credit.cents <= 0) continue;
    grouped.set(credit.accountCode, (grouped.get(credit.accountCode) ?? 0) + credit.cents);
  }
  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  const lines: DraftLine[] = [
    { accountCode: CODES.wip, debitCents: total, creditCents: 0, memo: "Batch started" },
  ];
  for (const [accountCode, cents] of grouped) {
    lines.push({ accountCode, debitCents: 0, creditCents: cents, memo: "Issued to the batch" });
  }
  return lines;
}

/** Finished-goods debit is the lot value. Any leftover penny goes to inventory adjustments so the books match the lots. */
export function finishJournal(input: { wipCents: number; utilityCents: number; fgCents: number }): DraftLine[] {
  const total = input.wipCents + input.utilityCents;
  const drift = total - input.fgCents;
  const lines: DraftLine[] = [
    { accountCode: CODES.invFg, debitCents: input.fgCents, creditCents: 0, memo: "Finished lot" },
  ];
  if (drift > 0) {
    lines.push({ accountCode: CODES.adjustment, debitCents: drift, creditCents: 0, memo: "Rounding" });
  }
  if (input.wipCents > 0) {
    lines.push({ accountCode: CODES.wip, debitCents: 0, creditCents: input.wipCents, memo: "Batch finished" });
  }
  if (input.utilityCents > 0) {
    lines.push({
      accountCode: CODES.utilityApplied,
      debitCents: 0,
      creditCents: input.utilityCents,
      memo: "Utility cost in the batch",
    });
  }
  if (drift < 0) {
    lines.push({
      accountCode: CODES.adjustment,
      debitCents: 0,
      creditCents: -drift,
      memo: "Rounding",
    });
  }
  return lines;
}

export function openingJournal(input: { cashCents: number; rawCents: number; fgCents: number }): DraftLine[] {
  const lines: DraftLine[] = [];
  if (input.cashCents > 0) {
    lines.push({ accountCode: CODES.cash, debitCents: input.cashCents, creditCents: 0, memo: "Opening cash" });
  }
  if (input.rawCents > 0) {
    lines.push({ accountCode: CODES.invRaw, debitCents: input.rawCents, creditCents: 0, memo: "Opening raw material" });
  }
  if (input.fgCents > 0) {
    lines.push({
      accountCode: CODES.invFg,
      debitCents: input.fgCents,
      creditCents: 0,
      memo: "Opening finished goods",
    });
  }
  const total = input.cashCents + input.rawCents + input.fgCents;
  lines.push({ accountCode: CODES.obe, debitCents: 0, creditCents: total, memo: "Opening balances" });
  return lines;
}

export function bankLineJournal(amountCents: number): DraftLine[] {
  if (amountCents < 0) {
    const cents = -amountCents;
    return [
      { accountCode: CODES.bankFees, debitCents: cents, creditCents: 0, memo: "Bank fee" },
      { accountCode: CODES.cash, debitCents: 0, creditCents: cents, memo: "Bank fee" },
    ];
  }
  return [
    { accountCode: CODES.cash, debitCents: amountCents, creditCents: 0, memo: "Money in from the bank" },
    { accountCode: CODES.otherIncome, debitCents: 0, creditCents: amountCents, memo: "Money in from the bank" },
  ];
}

export function adjustmentJournal(input: { accountCode: string; deltaCents: number }): DraftLine[] {
  if (input.deltaCents > 0) {
    return [
      { accountCode: input.accountCode, debitCents: input.deltaCents, creditCents: 0, memo: "Quantity correction" },
      { accountCode: CODES.adjustment, debitCents: 0, creditCents: input.deltaCents, memo: "Quantity correction" },
    ];
  }
  const cents = -input.deltaCents;
  return [
    { accountCode: CODES.adjustment, debitCents: cents, creditCents: 0, memo: "Quantity correction" },
    { accountCode: input.accountCode, debitCents: 0, creditCents: cents, memo: "Quantity correction" },
  ];
}

function signed(line: PostedLine): number {
  if (line.accountType === "ASSET" || line.accountType === "EXPENSE" || line.accountType === "COGS") {
    return line.debitCents - line.creditCents;
  }
  return line.creditCents - line.debitCents;
}

export function normalBalance(lines: PostedLine[], accountCode: string): number {
  return lines.filter((line) => line.accountCode === accountCode).reduce((sum, line) => sum + signed(line), 0);
}

export function trialBalance(lines: PostedLine[]): {
  debitCents: number;
  creditCents: number;
  balanced: boolean;
  rows: { accountCode: string; accountName: string; accountType: AccountTypeName; debitCents: number; creditCents: number }[];
} {
  const map = new Map<string, { accountName: string; accountType: AccountTypeName; debitCents: number; creditCents: number }>();
  for (const line of lines) {
    const row = map.get(line.accountCode) ?? {
      accountName: line.accountName,
      accountType: line.accountType,
      debitCents: 0,
      creditCents: 0,
    };
    row.debitCents += line.debitCents;
    row.creditCents += line.creditCents;
    map.set(line.accountCode, row);
  }
  const rows = [...map.entries()]
    .map(([accountCode, row]) => ({ accountCode, ...row }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const debitCents = rows.reduce((sum, row) => sum + row.debitCents, 0);
  const creditCents = rows.reduce((sum, row) => sum + row.creditCents, 0);
  return { debitCents, creditCents, balanced: debitCents === creditCents, rows };
}

export function profitAndLoss(lines: PostedLine[], from: string, to: string) {
  const inRange = lines.filter((line) => line.date >= from && line.date <= to);
  const section = (type: AccountTypeName) => {
    const map = new Map<string, { name: string; cents: number }>();
    for (const line of inRange.filter((item) => item.accountType === type)) {
      const row = map.get(line.accountCode) ?? { name: line.accountName, cents: 0 };
      row.cents += signed(line);
      map.set(line.accountCode, row);
    }
    const rows = [...map.entries()]
      .map(([accountCode, row]) => ({ accountCode, ...row }))
      .filter((row) => row.cents !== 0)
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return { rows, totalCents: rows.reduce((sum, row) => sum + row.cents, 0) };
  };
  const income = section("INCOME");
  const cogs = section("COGS");
  const expense = section("EXPENSE");
  return {
    income,
    cogs,
    expense,
    profitCents: income.totalCents - cogs.totalCents - expense.totalCents,
  };
}

export function balanceSheet(lines: PostedLine[], asOf: string) {
  const asOfLines = lines.filter((line) => line.date <= asOf);
  const section = (type: AccountTypeName) => {
    const map = new Map<string, { name: string; cents: number }>();
    for (const line of asOfLines.filter((item) => item.accountType === type)) {
      const row = map.get(line.accountCode) ?? { name: line.accountName, cents: 0 };
      row.cents += signed(line);
      map.set(line.accountCode, row);
    }
    const rows = [...map.entries()]
      .map(([accountCode, row]) => ({ accountCode, ...row }))
      .filter((row) => row.cents !== 0)
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return { rows, totalCents: rows.reduce((sum, row) => sum + row.cents, 0) };
  };
  const assets = section("ASSET");
  const liabilities = section("LIABILITY");
  const equity = section("EQUITY");
  const income = section("INCOME").totalCents;
  const cogs = section("COGS").totalCents;
  const expense = section("EXPENSE").totalCents;
  const earningsCents = income - cogs - expense;
  const rightSide = liabilities.totalCents + equity.totalCents + earningsCents;
  return {
    assets,
    liabilities,
    equity,
    earningsCents,
    balanced: assets.totalCents === rightSide,
    rightSideCents: rightSide,
  };
}
