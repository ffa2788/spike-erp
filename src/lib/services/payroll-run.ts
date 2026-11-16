import { CHART, CODES } from "../chart";
import { parseDateInput } from "../dates";
import { prisma } from "../db";
import { journalProblem } from "../journals";
import { calculatePay, payrollJournal, postingBlock, type PayMode, type PayrollTable } from "../payroll";
import { err, ok, type Result } from "../result";
import { nextNumber, postJournal, run, type Actor } from "./shared";

const PAYROLL_CODES = [CODES.wages, CODES.employerTax, CODES.payrollLiab];

async function ensurePayrollAccounts() {
  for (const account of CHART.filter((row) => PAYROLL_CODES.includes(row.code as typeof PAYROLL_CODES[number]))) {
    await prisma.account.upsert({
      where: { code: account.code },
      update: { name: account.name, type: account.type },
      create: { ...account, isExample: true },
    });
  }
}

export async function ensurePayrollTable(): Promise<PayrollTable & { note: string }> {
  const row = await prisma.payrollTaxTable.upsert({
    where: { id: "current" },
    update: {},
    create: {},
  });
  return row;
}

export async function savePayrollTable(input: PayrollTable & { note: string }) {
  await prisma.payrollTaxTable.upsert({
    where: { id: "current" },
    update: { ...input, reviewed: false },
    create: { id: "current", ...input, reviewed: false },
  });
}

export async function reviewPayrollTable(reviewed: boolean) {
  await prisma.payrollTaxTable.upsert({
    where: { id: "current" },
    update: { reviewed },
    create: { reviewed },
  });
}

export async function createPayRun(actor: Actor, input: {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  mode: PayMode;
  lines: { employeeId: string; hours: number; grossCents: number; entered?: PayRequestEntered }[];
}): Promise<Result<{ id: string }>> {
  const start = parseDateInput(input.periodStart);
  const end = parseDateInput(input.periodEnd);
  const payDate = parseDateInput(input.payDate);
  if (!start || !end || !payDate) return err("Enter the pay period and the pay date.");
  const table = await ensurePayrollTable();
  const block = postingBlock(table, input.mode);
  const employees = await prisma.employee.findMany({ where: { active: true } });
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const stubs = [];
  for (const line of input.lines) {
    const employee = byId.get(line.employeeId);
    if (!employee) continue;
    const prior = await prisma.payStub.findMany({
      where: { employeeId: employee.id, run: { status: "POSTED", payDate: { gte: new Date(`${payDate.getUTCFullYear()}-01-01T00:00:00Z`), lt: payDate } } },
    });
    const ytd = prior.reduce((sum, stub) => sum + stub.grossCents, 0);
    const gross = employee.payType === "HOURLY" ? Math.round(line.hours * employee.rateCents) : employee.rateCents;
    const amounts = calculatePay(table, {
      grossCents: input.mode === "PROVIDER" ? line.grossCents : gross,
      ytdGrossBeforeCents: ytd,
      federalWithholdingBps: employee.federalWithholdingBps,
      mode: input.mode,
      entered: line.entered,
    });
    if (amounts.grossCents <= 0) continue;
    stubs.push({ employeeId: employee.id, hours: line.hours, ...amounts });
  }
  if (stubs.length === 0) return err("Enter hours or a gross amount for at least one person.");
  const run = await prisma.payRun.create({
    data: {
      number: await prisma.$transaction((tx) => nextNumber(tx, "payrun")),
      periodStart: start,
      periodEnd: end,
      payDate,
      source: input.mode,
      notes: block ?? (input.mode === "PROVIDER" ? "Amounts entered from the payroll provider. SPIKE did not calculate the taxes." : "Calculated from the reviewed tax table. This is not a filing."),
      isExample: true,
      stubs: { create: stubs },
    },
  });
  void actor;
  return ok({ id: run.id });
}

type PayRequestEntered = {
  federalWithholdingCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  futaCents: number;
  floridaCents: number;
};

export async function postPayRun(actor: Actor, runId: string): Promise<Result<{ id: string }>> {
  await ensurePayrollAccounts();
  const table = await ensurePayrollTable();
  return run(async (tx) => {
    const payRun = await tx.payRun.findUnique({ where: { id: runId }, include: { stubs: true } });
    if (!payRun) return err("That pay run was not found.");
    if (payRun.status === "POSTED") return err("This pay run is already in the books.");
    const mode: PayMode = payRun.source === "PROVIDER" ? "PROVIDER" : "CALCULATOR";
    const block = postingBlock(table, mode);
    if (block) return err(block);
    const lines = payrollJournal(payRun.stubs);
    const problem = journalProblem(lines);
    if (problem) return err(problem);
    const journal = await postJournal(tx, actor, {
      date: payRun.payDate,
      memo: `Payroll ${payRun.number}`,
      source: "PAYROLL",
      sourceId: payRun.id,
      lines,
      isExample: payRun.isExample,
    });
    if (!journal.ok) return journal;
    await tx.payRun.update({ where: { id: payRun.id }, data: { status: "POSTED", journalId: journal.value } });
    return ok({ id: payRun.id });
  });
}
