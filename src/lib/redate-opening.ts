import { usd } from "./format";
import { valueCents } from "./inventory";
import { parseDateInput } from "./dates";

/** Cutover date for the Peachtree opening load. */
export const OPENING_AS_OF = "2026-10-31";

export const OPENING_TOTALS = {
  trialCents: 85_244_320,
  inventoryCents: 18_543_537,
  accounts: [
    { code: "1100", side: "Dr" as const, cents: 33_608_758 },
    { code: "2000", side: "Cr" as const, cents: 2_428_677 },
    { code: "1991", side: "Cr" as const, cents: 1_702_616 },
    { code: "1992", side: "Dr" as const, cents: 947_549 },
    { code: "1993", side: "Dr" as const, cents: 140_034 },
  ],
};

export type OpeningSnapshot = {
  trialDebit: number;
  trialCredit: number;
  inventoryCents: number;
  accounts: { code: string; debit: number; credit: number }[];
};

export function snapshotOpening(input: {
  journalLines: { accountCode: string; debitCents: number; creditCents: number }[];
  lots: { qty: number; unitCost: number }[];
}): OpeningSnapshot {
  const accounts = [...new Set(input.journalLines.map((line) => line.accountCode))].sort().map((code) => {
    const lines = input.journalLines.filter((line) => line.accountCode === code);
    return {
      code,
      debit: lines.reduce((sum, line) => sum + line.debitCents, 0),
      credit: lines.reduce((sum, line) => sum + line.creditCents, 0),
    };
  });
  return {
    trialDebit: input.journalLines.reduce((sum, line) => sum + line.debitCents, 0),
    trialCredit: input.journalLines.reduce((sum, line) => sum + line.creditCents, 0),
    inventoryCents: input.lots.reduce((sum, lot) => sum + valueCents(lot.qty, lot.unitCost), 0),
    accounts,
  };
}

export function accountSide(debit: number, credit: number, side: "Dr" | "Cr"): number {
  return side === "Dr" ? debit - credit : credit - debit;
}

export function totalsProblem(snapshot: OpeningSnapshot): string | null {
  if (snapshot.trialDebit !== snapshot.trialCredit || snapshot.trialDebit !== OPENING_TOTALS.trialCents) {
    return `Opening trial is ${usd(snapshot.trialDebit)} debits and ${usd(snapshot.trialCredit)} credits. It must stay ${usd(OPENING_TOTALS.trialCents)} and balanced.`;
  }
  if (snapshot.inventoryCents !== OPENING_TOTALS.inventoryCents) {
    return `Opening stock is ${usd(snapshot.inventoryCents)}. It must stay ${usd(OPENING_TOTALS.inventoryCents)}.`;
  }
  for (const expected of OPENING_TOTALS.accounts) {
    const row = snapshot.accounts.find((account) => account.code === expected.code);
    const net = row ? accountSide(row.debit, row.credit, expected.side) : null;
    if (net !== expected.cents) {
      return `Account ${expected.code} is ${row ? `${usd(net ?? 0)} ${expected.side}` : "missing"}. It must stay ${usd(expected.cents)} ${expected.side}.`;
    }
  }
  return null;
}

export function totalsChanged(before: OpeningSnapshot, after: OpeningSnapshot): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Refuse when a row's date, or the target date, is on or before the closed-through day. */
export function closedPeriodProblem(dates: string[], closedThrough: string | null, target: string): string | null {
  if (!closedThrough) return null;
  if (!parseDateInput(closedThrough)) return "BOOKS_CLOSED_THROUGH must look like 2026-10-31.";
  if (target <= closedThrough) {
    return `${target} is in a closed period through ${closedThrough}. Nothing was written.`;
  }
  const hit = dates.find((date) => date <= closedThrough);
  if (hit) return `${hit} is in a closed period through ${closedThrough}. Nothing was written.`;
  return null;
}
