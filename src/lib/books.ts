import { usd } from "./format";

export function booksAgree(input: {
  trialDebit: number;
  trialCredit: number;
  arGl: number;
  arSub: number;
  apGl: number;
  apSub: number;
  inventoryGl: number;
  inventoryLots: number;
  shippedGl?: number;
  shippedSub?: number;
}): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (input.trialDebit !== input.trialCredit) {
    problems.push(
      `The trial balance is off by ${usd(input.trialDebit - input.trialCredit)}. Debits and credits must match.`,
    );
  }
  if (input.arGl !== input.arSub) {
    problems.push(
      `Customers owe ${usd(input.arSub)} on invoices, but the accounts receivable account says ${usd(input.arGl)}.`,
    );
  }
  if (input.apGl !== input.apSub) {
    problems.push(
      `We owe ${usd(input.apSub)} on bills, but the accounts payable account says ${usd(input.apGl)}.`,
    );
  }
  if (input.inventoryGl !== input.inventoryLots) {
    problems.push(
      `Lot costs add up to ${usd(input.inventoryLots)}, but the inventory accounts say ${usd(input.inventoryGl)}.`,
    );
  }
  if (
    input.shippedGl != null &&
    input.shippedSub != null &&
    input.shippedGl !== input.shippedSub
  ) {
    problems.push(
      `Deliveries waiting for an invoice cost ${usd(input.shippedSub)}, but the shipped-not-billed account says ${usd(input.shippedGl)}.`,
    );
  }
  return { ok: problems.length === 0, problems };
}
