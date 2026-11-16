import { CODES } from "./chart";
import type { DraftLine } from "./journals";

/** Example rates only. Posting a calculated paycheck requires the accountant to mark the table reviewed. */
export type PayrollTable = {
  reviewed: boolean;
  socialSecurityBps: number;
  socialSecurityWageBaseCents: number;
  medicareBps: number;
  futaBps: number;
  futaWageBaseCents: number;
  floridaBps: number;
  floridaWageBaseCents: number;
};

export type PayMode = "CALCULATOR" | "PROVIDER";

export type PayRequest = {
  grossCents: number;
  ytdGrossBeforeCents: number;
  federalWithholdingBps: number;
  mode: PayMode;
  entered?: {
    federalWithholdingCents: number;
    socialSecurityCents: number;
    medicareCents: number;
    futaCents: number;
    floridaCents: number;
  };
};

export type PayAmounts = {
  grossCents: number;
  federalWithholdingCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  employerSocialSecurityCents: number;
  employerMedicareCents: number;
  futaCents: number;
  floridaCents: number;
  netCents: number;
};

export function wageBaseSlice(ytdBeforeCents: number, grossCents: number, baseCents: number): number {
  const room = Math.max(0, baseCents - Math.max(0, ytdBeforeCents));
  return Math.min(Math.max(0, grossCents), room);
}

function part(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10000);
}

export function calculatePay(table: PayrollTable, input: PayRequest): PayAmounts {
  const grossCents = Math.max(0, input.grossCents);
  if (input.mode === "PROVIDER" && input.entered) {
    const federalWithholdingCents = Math.max(0, input.entered.federalWithholdingCents);
    const socialSecurityCents = Math.max(0, input.entered.socialSecurityCents);
    const medicareCents = Math.max(0, input.entered.medicareCents);
    const futaCents = Math.max(0, input.entered.futaCents);
    const floridaCents = Math.max(0, input.entered.floridaCents);
    return {
      grossCents,
      federalWithholdingCents,
      socialSecurityCents,
      medicareCents,
      employerSocialSecurityCents: socialSecurityCents,
      employerMedicareCents: medicareCents,
      futaCents,
      floridaCents,
      netCents: Math.max(0, grossCents - federalWithholdingCents - socialSecurityCents - medicareCents),
    };
  }
  const ssWages = wageBaseSlice(input.ytdGrossBeforeCents, grossCents, table.socialSecurityWageBaseCents);
  const futaWages = wageBaseSlice(input.ytdGrossBeforeCents, grossCents, table.futaWageBaseCents);
  const floridaWages = wageBaseSlice(input.ytdGrossBeforeCents, grossCents, table.floridaWageBaseCents);
  const socialSecurityCents = part(ssWages, table.socialSecurityBps);
  const medicareCents = part(grossCents, table.medicareBps);
  const federalWithholdingCents = part(grossCents, input.federalWithholdingBps);
  const futaCents = part(futaWages, table.futaBps);
  const floridaCents = part(floridaWages, table.floridaBps);
  return {
    grossCents,
    federalWithholdingCents,
    socialSecurityCents,
    medicareCents,
    employerSocialSecurityCents: socialSecurityCents,
    employerMedicareCents: medicareCents,
    futaCents,
    floridaCents,
    netCents: Math.max(0, grossCents - federalWithholdingCents - socialSecurityCents - medicareCents),
  };
}

export function postingBlock(table: { reviewed: boolean }, mode: PayMode): string | null {
  if (mode === "CALCULATOR" && !table.reviewed) {
    return "The accountant has not reviewed the tax table, so a calculated pay run cannot be posted.";
  }
  return null;
}

export function payrollJournal(stubs: PayAmounts[]): DraftLine[] {
  const totals = stubs.reduce(
    (sum, stub) => ({
      gross: sum.gross + stub.grossCents,
      net: sum.net + stub.netCents,
      federal: sum.federal + stub.federalWithholdingCents + stub.socialSecurityCents + stub.employerSocialSecurityCents + stub.medicareCents + stub.employerMedicareCents,
      employer: sum.employer + stub.employerSocialSecurityCents + stub.employerMedicareCents + stub.futaCents + stub.floridaCents,
      futa: sum.futa + stub.futaCents,
      florida: sum.florida + stub.floridaCents,
    }),
    { gross: 0, net: 0, federal: 0, employer: 0, futa: 0, florida: 0 },
  );
  const lines: DraftLine[] = [
    { accountCode: CODES.wages, debitCents: totals.gross, creditCents: 0, memo: "Wages" },
  ];
  if (totals.employer > 0) lines.push({ accountCode: CODES.employerTax, debitCents: totals.employer, creditCents: 0, memo: "Employer payroll taxes" });
  if (totals.net > 0) lines.push({ accountCode: CODES.cash, debitCents: 0, creditCents: totals.net, memo: "Net pay" });
  const federal = totals.federal;
  if (federal > 0) lines.push({ accountCode: CODES.payrollLiab, debitCents: 0, creditCents: federal + totals.futa + totals.florida, memo: "Payroll taxes withheld and employer taxes" });
  return lines.filter((line) => line.debitCents > 0 || line.creditCents > 0);
}

export type StubForQuarter = PayAmounts & { payDate: string };

export function quarterlyPayroll(year: number, quarter: 1 | 2 | 3 | 4, stubs: StubForQuarter[]) {
  const startMonth = (quarter - 1) * 3 + 1;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const to = `${year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  const inQuarter = stubs.filter((stub) => stub.payDate >= from && stub.payDate <= to);
  const inYear = stubs.filter((stub) => stub.payDate.slice(0, 4) === String(year) && stub.payDate <= to);
  const sum = (rows: StubForQuarter[], pick: (row: StubForQuarter) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    from,
    to,
    form941: {
      wagesCents: sum(inQuarter, (row) => row.grossCents),
      federalWithholdingCents: sum(inQuarter, (row) => row.federalWithholdingCents),
      socialSecurityTaxCents: sum(inQuarter, (row) => row.socialSecurityCents + row.employerSocialSecurityCents),
      medicareTaxCents: sum(inQuarter, (row) => row.medicareCents + row.employerMedicareCents),
    },
    form940: {
      quarterFutaCents: sum(inQuarter, (row) => row.futaCents),
      yearToDateFutaCents: sum(inYear, (row) => row.futaCents),
      yearToDateWagesCents: sum(inYear, (row) => row.grossCents),
    },
    rt6: {
      wagesCents: sum(inQuarter, (row) => row.grossCents),
      taxCents: sum(inQuarter, (row) => row.floridaCents),
    },
  };
}
