import { CODES } from "./chart";
import { prisma } from "./db";
import { toDateInput } from "./dates";
import { lotQty, valueCents } from "./inventory";
import { normalBalance, trialBalance, type PostedLine } from "./journals";
import { booksAgree } from "./books";
import { loadBalances } from "./services/shared";

export async function currentStock() {
  return prisma.$transaction((tx) => loadBalances(tx));
}

export async function postedLines(): Promise<PostedLine[]> {
  const lines = await prisma.journalLine.findMany({ include: { account: true, entry: true } });
  return lines.map((line) => ({
    accountCode: line.account.code,
    accountName: line.account.name,
    accountType: line.account.type,
    debitCents: line.debitCents,
    creditCents: line.creditCents,
    date: toDateInput(line.entry.date),
  }));
}

export async function assessBooks() {
  const lines = await postedLines();
  const trial = trialBalance(lines);
  const arGl = normalBalance(lines, CODES.ar);
  const apGl = normalBalance(lines, CODES.ap);
  const inventoryGl =
    normalBalance(lines, CODES.invRaw) + normalBalance(lines, CODES.invFg) + normalBalance(lines, CODES.wip);
  const shippedGl = normalBalance(lines, CODES.shipped);
  const invoices = await prisma.invoice.findMany();
  const bills = await prisma.vendorBill.findMany();
  const arSub = invoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0);
  const apSub = bills.reduce((sum, bill) => sum + bill.balanceCents, 0);
  const stock = await currentStock();
  const inventoryLots = stock.reduce((sum, lot) => sum + valueCents(lotQty(lot), lot.unitCost), 0);
  const waiting = await prisma.delivery.findMany({ where: { invoice: null }, include: { lines: true } });
  const shippedSub = waiting.reduce(
    (sum, delivery) => sum + delivery.lines.reduce((inner, line) => inner + line.cogsCents, 0),
    0,
  );
  const check = booksAgree({
    trialDebit: trial.debitCents,
    trialCredit: trial.creditCents,
    arGl,
    arSub,
    apGl,
    apSub,
    inventoryGl,
    inventoryLots,
    shippedGl,
    shippedSub,
  });
  return {
    check,
    trial,
    arGl,
    arSub,
    apGl,
    apSub,
    inventoryGl,
    inventoryLots,
    shippedGl,
    shippedSub,
    cashCents: normalBalance(lines, CODES.cash),
    lines,
  };
}
