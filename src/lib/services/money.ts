import { CHART, CODES, inventoryAccount } from "../chart";
import { toDateInput } from "../dates";
import { explainBank, parseBankCsv, suggestBankMatches } from "../bank";
import { lotQty, reliefCents, valueCents } from "../inventory";
import { adjustmentJournal, bankLineJournal, openingJournal, type DraftLine } from "../journals";
import { err, ok, type Result } from "../result";
import {
  audit,
  deny,
  loadBalances,
  locationByCode,
  postJournal,
  run,
  type Actor,
  type Tx,
} from "./shared";

export async function ensureFoundation(actor: Actor): Promise<Result<{ accounts: number }>> {
  return run(async (tx) => {
    for (const account of CHART) {
      await tx.account.upsert({
        where: { code: account.code },
        update: { name: account.name, type: account.type },
        create: { ...account, isExample: true },
      });
    }
    const sequences = [
      ["quote", 1001],
      ["order", 1001],
      ["delivery", 1001],
      ["invoice", 1001],
      ["receipt-pay", 1001],
      ["po", 1001],
      ["receipt", 1001],
      ["bill", 1001],
      ["vpay", 1001],
      ["batch", 1001],
      ["lot", 1001],
      ["journal", 1001],
    ] as const;
    for (const [name, next] of sequences) {
      await tx.numberSequence.upsert({ where: { name }, update: {}, create: { name, next } });
    }
    const locations = [
      ["QC", "Quarantine cage", false],
      ["MAIN", "Main warehouse", true],
      ["DOCK", "Shipping dock", true],
      ["REC", "Receiving floor", false],
    ] as const;
    for (const [code, name, shippable] of locations) {
      await tx.location.upsert({ where: { code }, update: { name, shippable }, create: { code, name, shippable } });
    }
    const bankAccount = await tx.account.findUnique({ where: { code: CODES.cash } });
    const existingBank = await tx.bankAccount.findFirst();
    if (!existingBank && bankAccount) {
      await tx.bankAccount.create({ data: { name: "Operating checking", glAccountId: bankAccount.id } });
    }
    await audit(tx, actor, "setup", "Company", "foundation", "Set up the chart of accounts, locations, and number sequences.");
    return ok({ accounts: CHART.length });
  });
}

export async function postOpening(
  actor: Actor,
  input: {
    date: Date;
    cashCents: number;
    isExample?: boolean;
    lots: {
      productId: string;
      qty: number;
      unitCost: number;
      lotNumber: string;
      expiresOn: Date | null;
      formulaVersion: number | null;
      nsfEligible: boolean;
      notes: string;
    }[];
  },
): Promise<Result<{ journalId: string }>> {
  const denied = deny(actor, "manualJournal");
  if (denied) return denied;
  return run(async (tx) => {
    const main = await locationByCode(tx, "MAIN");
    let rawCents = 0;
    let fgCents = 0;
    for (const line of input.lots) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product?.trackInventory) return err("Opening stock can only be recorded for products we store.");
      if (!(line.qty > 0) || !(line.unitCost > 0)) return err(`${product.name} needs a quantity and a real cost.`);
      const cents = valueCents(line.qty, line.unitCost);
      if (product.kind === "FINISHED") fgCents += cents;
      else rawCents += cents;
      const lot = await tx.lot.create({
        data: {
          lotNumber: line.lotNumber,
          productId: product.id,
          qcStatus: "APPROVED",
          unitCost: line.unitCost,
          receivedOn: input.date,
          expiresOn: line.expiresOn,
          origin: "OPENING",
          formulaVersion: line.formulaVersion,
          nsfEligible: line.nsfEligible,
          releasedOn: input.date,
          releasedBy: actor.name,
          notes: line.notes,
          isExample: input.isExample ?? false,
        },
      });
      await tx.movement.create({
        data: {
          lotId: lot.id,
          productId: product.id,
          locationId: main.id,
          qty: line.qty,
          reason: "OPENING",
          refType: "Opening",
          refId: lot.id,
        },
      });
    }
    const journal = await postJournal(tx, actor, {
      date: input.date,
      memo: "Opening balances",
      source: "OPENING",
      lines: openingJournal({ cashCents: input.cashCents, rawCents, fgCents }),
      isExample: input.isExample ?? false,
    });
    if (!journal.ok) return journal;
    return ok({ journalId: journal.value });
  });
}

export async function postManualJournal(
  actor: Actor,
  input: { date: Date; memo: string; lines: DraftLine[] },
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "manualJournal");
  if (denied) return denied;
  return run(async (tx) => {
    if (!input.memo.trim()) return err("Describe why you are making this entry.");
    const journal = await postJournal(tx, actor, {
      date: input.date,
      memo: input.memo.trim(),
      source: "MANUAL",
      lines: input.lines,
    });
    if (!journal.ok) return journal;
    return ok({ id: journal.value });
  });
}

export async function adjustLot(
  actor: Actor,
  input: { lotId: string; locationId: string; newQty: number; reason: string; date: Date },
): Promise<Result<{ lotId: string }>> {
  const denied = deny(actor, "manualJournal");
  if (denied) return denied;
  return run(async (tx) => {
    if (input.reason.trim().length < 8) return err("Write the reason for the quantity change.");
    if (input.newQty < 0) return err("Quantity cannot be negative.");
    const lot = await tx.lot.findUnique({ where: { id: input.lotId }, include: { product: true } });
    if (!lot) return err("That lot was not found.");
    const account = inventoryAccount(lot.product.kind);
    if (!account) return err("This item is not stored in inventory.");
    const balances = await loadBalances(tx, [lot.productId]);
    const balance = balances.find((item) => item.lotId === lot.id);
    if (!balance) return err("That lot has no stock record.");
    const place = balance.locations.find((item) => item.locationId === input.locationId) ?? {
      qty: 0,
      locationId: input.locationId,
    };
    const before = lotQty(balance);
    const after = before - place.qty + input.newQty;
    if (Math.abs(after - before) < 0.0001) return err("The quantity is already that amount.");
    const inventoryChange = -reliefCents(before, after, Number(lot.unitCost));
    await tx.movement.create({
      data: {
        lotId: lot.id,
        productId: lot.productId,
        locationId: input.locationId,
        qty: input.newQty - place.qty,
        reason: "ADJUSTMENT",
        refType: "Lot",
        refId: lot.id,
        note: input.reason.trim(),
      },
    });
    if (inventoryChange !== 0) {
      const journal = await postJournal(tx, actor, {
        date: input.date,
        memo: `Quantity correction ${lot.lotNumber}`,
        source: "ADJUSTMENT",
        sourceId: lot.id,
        lines: adjustmentJournal({ accountCode: account, deltaCents: inventoryChange }),
      });
      if (!journal.ok) return journal;
    }
    await audit(tx, actor, "adjust", "Lot", lot.id, `Corrected ${lot.lotNumber} to ${input.newQty}. ${input.reason.trim()}`);
    return ok({ lotId: lot.id });
  });
}

export async function transferLot(
  actor: Actor,
  input: { lotId: string; fromLocationId: string; toLocationId: string; qty: number; date: Date },
): Promise<Result<{ lotId: string }>> {
  const denied = deny(actor, "ship");
  if (denied) return denied;
  return run(async (tx) => {
    if (input.fromLocationId === input.toLocationId) return err("Choose two different locations.");
    if (!(input.qty > 0)) return err("Enter a quantity to move.");
    const lot = await tx.lot.findUnique({ where: { id: input.lotId } });
    if (!lot) return err("That lot was not found.");
    if (lot.qcStatus !== "APPROVED") return err("Only a released lot can be moved. Quality lots stay in quarantine.");
    const balances = await loadBalances(tx, [lot.productId]);
    const balance = balances.find((item) => item.lotId === lot.id);
    const place = balance?.locations.find((item) => item.locationId === input.fromLocationId);
    if (!place || place.qty + 0.0001 < input.qty) return err("There is not that much in the location you chose.");
    await tx.movement.create({
      data: {
        at: input.date,
        lotId: lot.id,
        productId: lot.productId,
        locationId: input.fromLocationId,
        qty: -input.qty,
        reason: "TRANSFER",
        refType: "Lot",
        refId: lot.id,
      },
    });
    await tx.movement.create({
      data: {
        at: input.date,
        lotId: lot.id,
        productId: lot.productId,
        locationId: input.toLocationId,
        qty: input.qty,
        reason: "TRANSFER",
        refType: "Lot",
        refId: lot.id,
      },
    });
    await audit(tx, actor, "transfer", "Lot", lot.id, `Moved ${input.qty} of lot ${lot.lotNumber}.`);
    return ok({ lotId: lot.id });
  });
}

export async function importBankStatement(
  actor: Actor,
  input: { csv: string; fileName: string; statementDate: Date; endingBalanceCents: number },
): Promise<Result<{ imported: number; skipped: number }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const parsed = parseBankCsv(input.csv);
    if (parsed.errors.length) return err(parsed.errors[0]);
    if (parsed.rows.length === 0) return err("The statement has no lines.");
    const bank = await tx.bankAccount.findFirst({ where: { active: true } });
    if (!bank) return err("Set up the bank account first.");
    const statement = await tx.statementImport.create({
      data: {
        bankAccountId: bank.id,
        statementDate: input.statementDate,
        endingBalanceCents: input.endingBalanceCents,
        fileName: input.fileName || "statement.csv",
      },
    });
    let imported = 0;
    let skipped = 0;
    for (const [index, row] of parsed.rows.entries()) {
      const fingerprint = `${row.date}|${row.amountCents}|${row.description.toLowerCase()}|${index}`;
      const existing = await tx.statementLine.findUnique({
        where: { bankAccountId_fingerprint: { bankAccountId: bank.id, fingerprint } },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await tx.statementLine.create({
        data: {
          importId: statement.id,
          bankAccountId: bank.id,
          postedOn: new Date(`${row.date}T12:00:00Z`),
          description: row.description,
          amountCents: row.amountCents,
          fingerprint,
        },
      });
      imported += 1;
    }
    await audit(tx, actor, "import", "StatementImport", statement.id, `Imported ${imported} bank lines.`);
    return ok({ imported, skipped });
  });
}

async function cashMoves(tx: Tx) {
  const cash = await tx.account.findUnique({ where: { code: CODES.cash } });
  if (!cash) return [];
  const lines = await tx.journalLine.findMany({
    where: { accountId: cash.id },
    include: { entry: true },
  });
  const map = new Map<string, { journalId: string; date: string; amountCents: number; label: string }>();
  for (const line of lines) {
    const row = map.get(line.entryId) ?? {
      journalId: line.entryId,
      date: toDateInput(line.entry.date),
      amountCents: 0,
      label: line.entry.memo,
    };
    row.amountCents += line.debitCents - line.creditCents;
    map.set(line.entryId, row);
  }
  const matched = new Set(
    (await tx.statementLine.findMany({ where: { reconciled: true, matchedJournalId: { not: null } } })).map(
      (line) => line.matchedJournalId,
    ),
  );
  return [...map.values()].map((move) => ({ ...move, matched: matched.has(move.journalId) }));
}

export async function bankPosition() {
  const { prisma } = await import("../db");
  return prisma.$transaction(async (tx) => readBank(tx));
}

async function readBank(tx: Tx) {
  const cash = await tx.account.findUnique({ where: { code: CODES.cash } });
  const lines = cash
    ? await tx.journalLine.findMany({ where: { accountId: cash.id } })
    : [];
  const bookCashCents = lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
  const latest = await tx.statementImport.findFirst({ orderBy: { createdAt: "desc" } });
  const statement = await tx.statementLine.findMany({ orderBy: { postedOn: "asc" } });
  const moves = await cashMoves(tx);
  const suggestions = suggestBankMatches(
    statement.filter((line) => !line.reconciled).map((line) => ({
      id: line.id,
      amountCents: line.amountCents,
      date: toDateInput(line.postedOn),
      matched: false,
    })),
    moves.filter((move) => !move.matched).map((move) => ({
      id: move.journalId,
      amountCents: move.amountCents,
      date: move.date,
      matched: false,
    })),
  );
  const suggestedStatements = new Set(suggestions.map((pair) => pair.statementId));
  const suggestedMoves = new Set(suggestions.map((pair) => pair.moveId));
  const bookNot = moves.filter((move) => !move.matched && !suggestedMoves.has(move.journalId));
  const statementNot = statement.filter((line) => !line.reconciled && !suggestedStatements.has(line.id));
  const openBook = moves.filter((move) => !move.matched);
  const openStatement = statement.filter((line) => !line.reconciled);
  const explained = explainBank({
    bookCashCents,
    statementEndingCents: latest?.endingBalanceCents ?? 0,
    bookNotOnStatementCents: bookNot.reduce((sum, move) => sum + move.amountCents, 0),
    statementNotInBooksCents: statementNot.reduce((sum, line) => sum + line.amountCents, 0),
    openBookCents: openBook.reduce((sum, move) => sum + move.amountCents, 0),
    openStatementCents: openStatement.reduce((sum, line) => sum + line.amountCents, 0),
  });
  return { bookCashCents, latest, statement, moves, suggestions, explained, openStatement: openStatement.length };
}

export async function matchAllSuggestions(actor: Actor): Promise<Result<{ matched: number }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const position = await readBank(tx);
    let matched = 0;
    for (const pair of position.suggestions) {
      const line = position.statement.find((item) => item.id === pair.statementId);
      const move = position.moves.find((item) => item.journalId === pair.moveId);
      if (!line || !move || line.reconciled || move.matched) continue;
      if (line.amountCents !== move.amountCents) continue;
      await tx.statementLine.update({
        where: { id: line.id },
        data: { reconciled: true, matchedKind: "JOURNAL", matchedId: move.journalId, matchedJournalId: move.journalId },
      });
      matched += 1;
    }
    await audit(tx, actor, "reconcile", "StatementLine", "match-all", `Matched ${matched} bank lines.`);
    return ok({ matched });
  });
}

export async function recordStatementLine(actor: Actor, lineId: string): Promise<Result<{ journalId: string }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const line = await tx.statementLine.findUnique({ where: { id: lineId } });
    if (!line) return err("That statement line was not found.");
    if (line.reconciled) return err("That line is already matched.");
    if (line.amountCents === 0) return err("A zero line cannot be recorded.");
    const journal = await postJournal(tx, actor, {
      date: line.postedOn,
      memo: line.description,
      source: line.amountCents < 0 ? "BANK_FEE" : "BANK_INTEREST",
      sourceId: line.id,
      lines: bankLineJournal(line.amountCents),
    });
    if (!journal.ok) return journal;
    await tx.statementLine.update({
      where: { id: line.id },
      data: { reconciled: true, matchedKind: "JOURNAL", matchedId: journal.value, matchedJournalId: journal.value },
    });
    await audit(tx, actor, "reconcile", "StatementLine", line.id, `Recorded “${line.description}” in the books.`);
    return ok({ journalId: journal.value });
  });
}

export async function markJournalReconciled(actor: Actor, journalId: string, statementLineId: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const line = await tx.statementLine.findUnique({ where: { id: statementLineId } });
    const entry = await tx.journalEntry.findUnique({ where: { id: journalId }, include: { lines: { include: { account: true } } } });
    if (!line || !entry) return err("That line or journal entry was not found.");
    if (line.reconciled) return err("That statement line is already matched.");
    const cash = entry.lines.filter((item) => item.account.code === CODES.cash).reduce((sum, item) => sum + item.debitCents - item.creditCents, 0);
    if (cash !== line.amountCents) return err("The amounts do not match.");
    await tx.statementLine.update({
      where: { id: line.id },
      data: { reconciled: true, matchedKind: "JOURNAL", matchedId: entry.id, matchedJournalId: entry.id },
    });
    await audit(tx, actor, "reconcile", "StatementLine", line.id, `Matched “${line.description}” to ${entry.number}.`);
    return ok({ id: line.id });
  });
}

export async function recordOpeningStatement(
  actor: Actor,
  input: { journalId: string; amountCents: number; date: Date },
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const bank = await tx.bankAccount.findFirst({ where: { active: true } });
    if (!bank) return err("Set up the bank account first.");
    const statement = await tx.statementImport.create({
      data: {
        bankAccountId: bank.id,
        statementDate: input.date,
        endingBalanceCents: input.amountCents,
        fileName: "Opening balance",
      },
    });
    const line = await tx.statementLine.create({
      data: {
        importId: statement.id,
        bankAccountId: bank.id,
        postedOn: input.date,
        description: "Opening balance",
        amountCents: input.amountCents,
        fingerprint: `opening|${input.journalId}`,
        reconciled: true,
        matchedKind: "JOURNAL",
        matchedId: input.journalId,
        matchedJournalId: input.journalId,
      },
    });
    await audit(tx, actor, "reconcile", "StatementLine", line.id, "Marked the opening cash balance as already on the statement.");
    return ok({ id: line.id });
  });
}
