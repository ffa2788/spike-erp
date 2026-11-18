import { Prisma } from "@prisma/client";
import { SEQUENCES } from "../chart";
import { prisma } from "../db";
import { toDateInput } from "../dates";
import { buildLotBalances, type LotBalance } from "../inventory";
import { journalProblem, type DraftLine } from "../journals";
import { can, type Action, type RoleName } from "../permissions";
import { err, ok, type Result } from "../result";

export type Actor = { id: string; name: string; role: RoleName };
export type Tx = Prisma.TransactionClient;

export class BusinessError extends Error {}

export function deny(actor: Actor, action: Action): Result<never> | null {
  if (!can(actor.role, action)) return err("Your role cannot do that.");
  return null;
}

export async function run<T>(work: (tx: Tx) => Promise<Result<T>>, timeout = 20000): Promise<Result<T>> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const result = await work(tx);
        if (!result.ok) throw new BusinessError(result.error);
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout },
    );
  } catch (error) {
    if (error instanceof BusinessError) return err(error.message);
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
    if (code === "P2034") {
      return err("Someone else changed this at the same time. Nothing was saved. Look again and retry.");
    }
    if (code === "P2002") return err("That record is already on file. Nothing was saved.");
    console.error(error);
    return err("Something went wrong. Nothing was saved.");
  }
}

export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string,
  summary: string,
) {
  await tx.auditLog.create({
    data: { userId: actor.id, userName: actor.name, action, entity, entityId, summary },
  });
}

export function formatSequence(name: string, value: number): string {
  if (name === "invoice-S" || name === "invoice-A" || name === "invoice-W") {
    const prefix = name.slice(-1);
    return `${prefix}-${String(value).padStart(6, "0")}`;
  }
  if (name === "quote") return `Q-${String(value).padStart(4, "0")}`;
  const sequence = SEQUENCES.find((item) => item.name === name);
  return `${sequence?.prefix ?? name}-${value}`;
}

/** Takes the next number inside the caller's transaction. A rollback puts the number back. A row lock makes two callers wait instead of taking the same number. */
export async function takeNumber(tx: Tx, name: string): Promise<number> {
  const sequence = SEQUENCES.find((item) => item.name === name);
  if (!sequence) throw new BusinessError(`Unknown number sequence ${name}.`);
  await tx.numberSequence.upsert({
    where: { name },
    update: {},
    create: { name, next: sequence.start },
  });
  const rows = await tx.$queryRaw<{ next: number }[]>`
    UPDATE "NumberSequence" SET next = next + 1 WHERE name = ${name} RETURNING next
  `;
  return Number(rows[0].next) - 1;
}

export async function nextNumber(tx: Tx, name: string): Promise<string> {
  return formatSequence(name, await takeNumber(tx, name));
}

export async function postJournal(
  tx: Tx,
  actor: Actor,
  input: {
    date: Date;
    memo: string;
    source: string;
    sourceId?: string;
    lines: DraftLine[];
    isExample?: boolean;
  },
): Promise<Result<string>> {
  const problem = journalProblem(input.lines);
  if (problem) return err(problem);
  const codes = [...new Set(input.lines.map((line) => line.accountCode))];
  const accounts = await tx.account.findMany({ where: { code: { in: codes } } });
  if (accounts.length !== codes.length) {
    const found = new Set(accounts.map((account) => account.code));
    const missing = codes.filter((code) => !found.has(code));
    return err(`Account ${missing[0]} is not on the chart of accounts.`);
  }
  const byCode = new Map(accounts.map((account) => [account.code, account.id]));
  const number = await nextNumber(tx, "journal");
  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: input.date,
      memo: input.memo,
      source: input.source,
      sourceId: input.sourceId ?? "",
      isExample: input.isExample ?? false,
      createdById: actor.id,
      lines: {
        create: input.lines.map((line) => ({
          accountId: byCode.get(line.accountCode)!,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
          memo: line.memo ?? "",
        })),
      },
    },
  });
  await audit(tx, actor, "post", "JournalEntry", entry.id, `Posted journal ${number}: ${input.memo}`);
  return ok(entry.id);
}

export async function loadBalances(tx: Tx, productIds?: string[]): Promise<LotBalance[]> {
  const lots = await tx.lot.findMany({
    where: productIds ? { productId: { in: productIds } } : undefined,
  });
  const movements = await tx.movement.findMany({
    where: productIds ? { productId: { in: productIds } } : undefined,
  });
  const locations = await tx.location.findMany();
  return buildLotBalances({
    lots: lots.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      productId: lot.productId,
      qcStatus: lot.qcStatus,
      expiresOn: lot.expiresOn ? toDateInput(lot.expiresOn) : null,
      receivedOn: toDateInput(lot.receivedOn ?? lot.manufacturedOn ?? new Date()),
      unitCost: Number(lot.unitCost),
      formulaVersion: lot.formulaVersion,
      nsfEligible: lot.nsfEligible,
    })),
    movements: movements.map((movement) => ({
      lotId: movement.lotId,
      locationId: movement.locationId,
      qty: Number(movement.qty),
    })),
    locations: locations.map((location) => ({
      id: location.id,
      code: location.code,
      shippable: location.shippable,
    })),
  });
}

export async function locationByCode(tx: Tx, code: string) {
  const location = await tx.location.findUnique({ where: { code } });
  if (!location) throw new BusinessError(`Location ${code} is not set up.`);
  return location;
}
