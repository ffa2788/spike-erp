import { parseCsv, pick } from "./csv";
import { daysBetween, parseLooseDate } from "./dates";
import { parseMoneyToCents } from "./pricing";

export type MatchCandidate = {
  id: string;
  amountCents: number;
  date: string;
  matched: boolean;
};

export function parseBankCsv(text: string): {
  rows: { date: string; description: string; amountCents: number }[];
  errors: string[];
} {
  const table = parseCsv(text);
  const errors: string[] = [];
  const rows: { date: string; description: string; amountCents: number }[] = [];
  if (table.headers.length === 0) return { rows, errors: ["The file is empty."] };
  table.rows.forEach((row, index) => {
    const date = parseLooseDate(pick(row, "Date", "Posted"));
    const description = pick(row, "Description", "Memo", "Name") || "Bank line";
    const amountRaw = pick(row, "Amount");
    let amount: number | null = null;
    if (amountRaw) {
      amount = parseMoneyToCents(amountRaw);
    } else {
      const debit = parseMoneyToCents(pick(row, "Debit") || "0");
      const credit = parseMoneyToCents(pick(row, "Credit") || "0");
      if (debit == null || credit == null) amount = null;
      else amount = credit - debit;
    }
    const problems: string[] = [];
    if (!date) problems.push("date");
    if (amount == null) problems.push("amount");
    if (amount === 0) problems.push("a zero amount");
    if (problems.length || !date || amount == null) {
      errors.push(`Row ${index + 2} needs ${problems.join(" and ") || "a valid date and amount"}.`);
      return;
    }
    rows.push({ date, description, amountCents: amount });
  });
  return { rows, errors };
}

export function suggestBankMatches(
  statement: MatchCandidate[],
  moves: MatchCandidate[],
  windowDays = 7,
): { statementId: string; moveId: string }[] {
  const used = new Set<string>();
  const pairs: { statementId: string; moveId: string }[] = [];
  const openStatement = statement.filter((line) => !line.matched);
  const openMoves = moves.filter((move) => !move.matched);
  for (const line of openStatement) {
    let best: { id: string; distance: number } | null = null;
    for (const move of openMoves) {
      if (used.has(move.id)) continue;
      if (move.amountCents !== line.amountCents) continue;
      const distance = Math.abs(daysBetween(line.date, move.date));
      if (distance > windowDays) continue;
      if (!best || distance < best.distance) best = { id: move.id, distance };
    }
    if (best) {
      used.add(best.id);
      pairs.push({ statementId: line.id, moveId: best.id });
    }
  }
  return pairs;
}

export function explainBank(input: {
  bookCashCents: number;
  statementEndingCents: number;
  bookNotOnStatementCents: number;
  statementNotInBooksCents: number;
  openBookCents: number;
  openStatementCents: number;
}): { gapCents: number; explained: boolean; agreesNow: boolean } {
  const gapCents =
    input.bookCashCents -
    input.statementEndingCents -
    input.bookNotOnStatementCents +
    input.statementNotInBooksCents;
  return {
    gapCents,
    explained: gapCents === 0,
    agreesNow:
      input.bookCashCents === input.statementEndingCents &&
      input.openBookCents === 0 &&
      input.openStatementCents === 0,
  };
}
