import "dotenv/config";
import { prisma } from "../src/lib/db";
import { toDateInput, parseDateInput } from "../src/lib/dates";
import { usd } from "../src/lib/format";
import { normalBalance, balanceSheet } from "../src/lib/journals";
import { assessBooks, postedLines } from "../src/lib/read-models";
import {
  OPENING_AS_OF,
  OPENING_TOTALS,
  accountSide,
  closedPeriodProblem,
  snapshotOpening,
  totalsChanged,
  totalsProblem,
  type OpeningSnapshot,
} from "../src/lib/redate-opening";

const apply = process.argv.includes("--apply");

function openingDate(): Date {
  const date = parseDateInput(OPENING_AS_OF);
  if (!date) throw new Error("The opening date is not a real day.");
  return date;
}

function day(value: Date | null): string {
  return value ? toDateInput(value) : "(none)";
}

function printSnapshot(label: string, snapshot: OpeningSnapshot) {
  console.log(label);
  console.log(`  trial debits ${usd(snapshot.trialDebit)}  credits ${usd(snapshot.trialCredit)}`);
  console.log(`  inventory ${usd(snapshot.inventoryCents)}`);
  for (const expected of OPENING_TOTALS.accounts) {
    const row = snapshot.accounts.find((account) => account.code === expected.code);
    const net = row ? accountSide(row.debit, row.credit, expected.side) : 0;
    console.log(`  ${expected.code} ${usd(net)} ${expected.side}`);
  }
}

async function load(tx: Pick<typeof prisma, "journalEntry" | "lot">) {
  const journals = await tx.journalEntry.findMany({
    where: { source: "OPENING", sourceId: "TRIAL" },
    include: { lines: { include: { account: true } } },
    orderBy: { number: "asc" },
  });
  const lots = await tx.lot.findMany({
    where: { origin: "OPENING", notes: "Opening count." },
    include: { movements: { where: { reason: "OPENING", refType: "Opening" }, orderBy: { id: "asc" } } },
    orderBy: { lotNumber: "asc" },
  });
  return { journals, lots };
}

function snapshotOf(found: Awaited<ReturnType<typeof load>>): OpeningSnapshot {
  return snapshotOpening({
    journalLines: found.journals.flatMap((entry) => entry.lines.map((line) => ({
      accountCode: line.account.code,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
    }))),
    lots: found.lots.flatMap((lot) => lot.movements.map((movement) => ({
      qty: Number(movement.qty),
      unitCost: Number(lot.unitCost),
    }))),
  });
}

function datesOf(found: Awaited<ReturnType<typeof load>>): string[] {
  const dates = [
    ...found.journals.map((entry) => toDateInput(entry.date)),
    ...found.lots.map((lot) => (lot.receivedOn ? toDateInput(lot.receivedOn) : "")),
    ...found.lots.flatMap((lot) => lot.movements.map((movement) => toDateInput(movement.at))),
  ];
  return dates.filter((date) => date);
}

function printPlan(found: Awaited<ReturnType<typeof load>>) {
  console.log(apply ? "Applying October 31, 2026." : "Dry run. Nothing will be written.");
  for (const entry of found.journals) {
    console.log(`journal ${entry.id} ${entry.number}  ${toDateInput(entry.date)} -> ${OPENING_AS_OF}`);
  }
  for (const lot of found.lots) {
    console.log(`lot ${lot.id} ${lot.lotNumber}  received ${day(lot.receivedOn)} released ${day(lot.releasedOn)} -> ${OPENING_AS_OF}`);
    for (const movement of lot.movements) {
      console.log(`movement ${movement.id}  ${toDateInput(movement.at)} -> ${OPENING_AS_OF}`);
    }
  }
  console.log(`${found.journals.length} opening trial journal(s), ${found.lots.length} opening lot(s).`);
}

async function main() {
  const closedThrough = (process.env.BOOKS_CLOSED_THROUGH ?? "").trim() || null;
  const found = await load(prisma);
  printPlan(found);
  if (found.journals.length === 0) throw new Error("No opening trial journal (source OPENING, source id TRIAL). Nothing was written.");
  if (found.lots.length === 0) throw new Error("No opening stock lots (origin OPENING, note Opening count.). Nothing was written.");
  const before = snapshotOf(found);
  printSnapshot("Totals before", before);
  const problem = totalsProblem(before) ?? closedPeriodProblem(datesOf(found), closedThrough, OPENING_AS_OF);
  if (problem) throw new Error(problem);
  if (!apply) {
    printSnapshot("Totals after (amounts only; dates are not applied yet)", before);
    console.log("Dry run. Run again with --apply to write October 31, 2026.");
    return;
  }
  await prisma.$transaction(async (tx) => {
    const current = await load(tx);
    const opened = snapshotOf(current);
    const blocked = totalsProblem(opened) ?? closedPeriodProblem(datesOf(current), closedThrough, OPENING_AS_OF);
    if (blocked) throw new Error(blocked);
    for (const entry of current.journals) {
      await tx.journalEntry.update({ where: { id: entry.id }, data: { date: openingDate() } });
    }
    for (const lot of current.lots) {
      await tx.lot.update({ where: { id: lot.id }, data: { receivedOn: openingDate(), releasedOn: openingDate() } });
      for (const movement of lot.movements) {
        await tx.movement.update({ where: { id: movement.id }, data: { at: openingDate() } });
      }
    }
    const after = snapshotOf(await load(tx));
    if (totalsChanged(opened, after)) throw new Error("Totals changed. Nothing was written.");
    const again = totalsProblem(after);
    if (again) throw new Error(again);
  });
  const after = snapshotOf(await load(prisma));
  printSnapshot("Totals after", after);
  const lines = await postedLines();
  const asOfLines = lines.filter((line) => line.date <= OPENING_AS_OF);
  console.log(`Balance sheet as of ${OPENING_AS_OF}`);
  for (const code of ["1100", "2000", "1991", "1992", "1993", "1200", "1210", "1220", "1240"]) {
    const picked = asOfLines.filter((line) => line.accountCode === code);
    const debit = picked.reduce((sum, line) => sum + line.debitCents, 0);
    const credit = picked.reduce((sum, line) => sum + line.creditCents, 0);
    const net = debit - credit;
    console.log(`  ${code} ${usd(Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}  (normal ${usd(normalBalance(asOfLines, code))})`);
  }
  const sheet = balanceSheet(lines, OPENING_AS_OF);
  console.log(`  assets ${usd(sheet.assets.totalCents)}  liabilities and equity ${usd(sheet.rightSideCents)}  balanced ${sheet.balanced ? "yes" : "no"}`);
  const books = await assessBooks();
  console.log(books.check.ok ? "Books agree." : `Books do not agree. ${books.check.problems.join(" ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
