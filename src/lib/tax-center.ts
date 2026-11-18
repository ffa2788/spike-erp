import type { AccountTypeName } from "./chart";

/** Payments made in 2026. IRS: the 1099-NEC / 1099-MISC threshold rose from $600 to $2,000. */
export const INFO_RETURN_THRESHOLD_2026_CENTS = 200_000;
export const INFO_RETURN_THRESHOLD_BEFORE_2026_CENTS = 60_000;

/** IRS Publication 946, tax years beginning in 2026. */
export const SECTION_179_LIMIT_2026_CENTS = 256_000_000;
export const SECTION_179_PHASEOUT_2026_CENTS = 409_000_000;

/** Florida DR-15 instructions: 2.5% of the first $1,200, and not more than $30. */
export const FL_STATE_RATE_BPS = 600;
export const SURTAX_ITEM_CAP_CENTS = 500_000;

export type EntityTypeName = "C_CORP" | "S_CORP";
export type InfoReturnName = "NONE" | "NEC" | "MISC";

export function infoReturnThresholdCents(year: number): number {
  return year >= 2026 ? INFO_RETURN_THRESHOLD_2026_CENTS : INFO_RETURN_THRESHOLD_BEFORE_2026_CENTS;
}

export function floridaCollectionAllowanceCents(amountDueCents: number): number {
  if (amountDueCents <= 0) return 0;
  const base = Math.min(amountDueCents, 120_000);
  return Math.min(Math.round(base * 0.025), 3_000);
}

export type DrInvoice = {
  issuedOn: string;
  locality: string;
  subtotalCents: number;
  taxableCents: number;
  taxCents: number;
  exemptionApplied: boolean;
  lines: { amountCents: number; taxable: boolean }[];
  countyRateBps: number;
};

export type Dr15Figures = {
  label: string;
  grossSalesCents: number;
  exemptSalesCents: number;
  taxableAmountCents: number;
  stateTaxCents: number;
  surtaxCents: number;
  taxDueCents: number;
  collectedTaxCents: number;
  overCapCents: number;
  collectionAllowanceCents: number;
  counties: { county: string; taxableCents: number; surtaxableCents: number; rateBps: number; surtaxCents: number }[];
};

function countyKey(locality: string): string {
  return locality.trim() || "No county on the invoice";
}

function oneInvoice(invoice: DrInvoice): { exempt: number; taxable: number; state: number; surtax: number; over: number; surtaxable: number } {
  if (invoice.exemptionApplied) {
    return { exempt: invoice.subtotalCents, taxable: 0, state: 0, surtax: 0, over: 0, surtaxable: 0 };
  }
  const taxable = invoice.taxableCents;
  const exempt = Math.max(0, invoice.subtotalCents - taxable);
  const taxableLines = invoice.lines.filter((line) => line.taxable && line.amountCents > 0);
  const basis = taxableLines.length ? taxableLines : [{ amountCents: taxable, taxable: true }];
  let over = 0;
  let surtaxable = 0;
  for (const line of basis) {
    if (line.amountCents > SURTAX_ITEM_CAP_CENTS) {
      surtaxable += SURTAX_ITEM_CAP_CENTS;
      over += line.amountCents - SURTAX_ITEM_CAP_CENTS;
    } else {
      surtaxable += line.amountCents;
    }
  }
  const state = Math.round((taxable * FL_STATE_RATE_BPS) / 10000);
  const surtax = Math.round((surtaxable * invoice.countyRateBps) / 10000);
  return { exempt, taxable, state, surtax, over, surtaxable };
}

export function floridaDr15(invoices: DrInvoice[], label: string): Dr15Figures {
  const counties = new Map<string, { taxableCents: number; surtaxableCents: number; rateBps: number; surtaxCents: number }>();
  let gross = 0;
  let exempt = 0;
  let taxable = 0;
  let state = 0;
  let surtax = 0;
  let collected = 0;
  let over = 0;
  for (const invoice of invoices) {
    gross += invoice.subtotalCents;
    collected += invoice.taxCents;
    const row = oneInvoice(invoice);
    exempt += row.exempt;
    taxable += row.taxable;
    state += row.state;
    surtax += row.surtax;
    over += row.over;
    if (row.taxable === 0 && row.surtax === 0) continue;
    const key = countyKey(invoice.locality);
    const bucket = counties.get(key) ?? { taxableCents: 0, surtaxableCents: 0, rateBps: invoice.countyRateBps, surtaxCents: 0 };
    bucket.taxableCents += row.taxable;
    bucket.surtaxableCents += row.surtaxable;
    bucket.surtaxCents += row.surtax;
    bucket.rateBps = invoice.countyRateBps;
    counties.set(key, bucket);
  }
  const taxDue = state + surtax;
  return {
    label,
    grossSalesCents: gross,
    exemptSalesCents: exempt,
    taxableAmountCents: taxable,
    stateTaxCents: state,
    surtaxCents: surtax,
    taxDueCents: taxDue,
    collectedTaxCents: collected,
    overCapCents: over,
    collectionAllowanceCents: floridaCollectionAllowanceCents(taxDue),
    counties: [...counties.entries()]
      .map(([county, row]) => ({ county, ...row }))
      .sort((a, b) => a.county.localeCompare(b.county)),
  };
}

export function vendorInfoReturns(
  vendors: { name: string; paidCents: number; w9OnFile: boolean; infoReturn: InfoReturnName }[],
  year: number,
): { name: string; paidCents: number; form: string; needsW9: boolean; file: boolean; reason: string }[] {
  const threshold = infoReturnThresholdCents(year);
  const dollars = `$${(threshold / 100).toLocaleString("en-US")}`;
  return vendors
    .map((vendor) => {
      if (vendor.infoReturn === "NONE") {
        return {
          name: vendor.name,
          paidCents: vendor.paidCents,
          form: "None",
          needsW9: false,
          file: false,
          reason: "Marked as goods or a corporation. No 1099-NEC or 1099-MISC from that setting.",
        };
      }
      const form = vendor.infoReturn === "NEC" ? "1099-NEC" : "1099-MISC";
      if (vendor.paidCents <= 0) {
        return { name: vendor.name, paidCents: 0, form, needsW9: !vendor.w9OnFile, file: false, reason: "No payments this year." };
      }
      if (vendor.paidCents < threshold) {
        return {
          name: vendor.name,
          paidCents: vendor.paidCents,
          form,
          needsW9: !vendor.w9OnFile,
          file: false,
          reason: `Under ${dollars}, the ${year} reporting amount. No form yet.${vendor.w9OnFile ? "" : " Ask for a Form W-9 before the payments grow."}`,
        };
      }
      if (!vendor.w9OnFile) {
        return {
          name: vendor.name,
          paidCents: vendor.paidCents,
          form,
          needsW9: true,
          file: true,
          reason: `Payments reached ${dollars}. The W-9 is missing, so backup withholding can apply (section 3406). Get Form W-9 before you file.`,
        };
      }
      return {
        name: vendor.name,
        paidCents: vendor.paidCents,
        form,
        needsW9: false,
        file: true,
        reason: `File ${form}. Payments are at least ${dollars} for ${year}.`,
      };
    })
    .sort((a, b) => b.paidCents - a.paidCents || a.name.localeCompare(b.name));
}

export type ReturnLine = { formLine: string; book: string; cents: number };

export function federalReturnLines(input: {
  entity: EntityTypeName;
  income: { name: string; cents: number }[];
  cogs: { name: string; cents: number }[];
  expense: { name: string; cents: number }[];
  inventoryCents: number;
  equipmentListCents: number;
  equipmentBookCents: number;
}): { formName: string; lines: ReturnLine[]; bookIncomeCents: number } {
  const sales = input.income.filter((row) => !/other income/i.test(row.name));
  const other = input.income.filter((row) => /other income/i.test(row.name));
  const salesCents = sales.reduce((sum, row) => sum + row.cents, 0);
  const otherCents = other.reduce((sum, row) => sum + row.cents, 0);
  const cogsCents = input.cogs.reduce((sum, row) => sum + row.cents, 0);
  const expenseCents = input.expense.reduce((sum, row) => sum + row.cents, 0);
  const sCorp = input.entity === "S_CORP";
  const formName = sCorp ? "Form 1120-S" : "Form 1120";
  const lines: ReturnLine[] = [
    { formLine: `${formName}, line 1a — Gross receipts`, book: sales.map((row) => row.name).join(", ") || "Product sales", cents: salesCents },
    { formLine: `${formName}, line 2 — Cost of goods sold`, book: input.cogs.map((row) => row.name).join(", ") || "Cost of goods sold", cents: cogsCents },
    { formLine: sCorp ? "Form 1120-S, line 3 — Gross profit" : "Form 1120, line 3 — Gross profit", book: "Receipts minus cost of goods sold", cents: salesCents - cogsCents },
    { formLine: sCorp ? "Form 1120-S, line 5 — Other income" : "Form 1120, line 10 — Other income", book: other.map((row) => row.name).join(", ") || "None", cents: otherCents },
    { formLine: sCorp ? "Form 1120-S, lines 7–19 — Deductions" : "Form 1120, lines 12–26 — Deductions", book: input.expense.map((row) => row.name).join(", ") || "None", cents: expenseCents },
    {
      formLine: sCorp ? "Form 1120-S, line 21 — Ordinary business income" : "Form 1120, line 28 — Taxable income before special deductions",
      book: "Book profit. Not the tax number until your CPA makes the adjustments.",
      cents: salesCents + otherCents - cogsCents - expenseCents,
    },
    { formLine: "Form 1125-A — Ending inventory", book: "Lot quantity times lot cost", cents: input.inventoryCents },
    { formLine: "Form 4562 and Schedule L — Equipment you listed", book: "Fixed asset list", cents: input.equipmentListCents },
    { formLine: "Schedule L — Equipment account in the journal", book: "Account 1500", cents: input.equipmentBookCents },
  ];
  return { formName, lines, bookIncomeCents: salesCents + otherCents - cogsCents - expenseCents };
}

export function section179Range(assets: { costCents: number; year: number; candidate: boolean }[], year: number): { count: number; costCents: number; lowCents: number; highCents: number } {
  const chosen = assets.filter((asset) => asset.year === year && asset.candidate && asset.costCents > 0);
  const costCents = chosen.reduce((sum, asset) => sum + asset.costCents, 0);
  const reducedLimit = Math.max(0, SECTION_179_LIMIT_2026_CENTS - Math.max(0, costCents - SECTION_179_PHASEOUT_2026_CENTS));
  return { count: chosen.length, costCents, lowCents: 0, highCents: Math.min(costCents, reducedLimit) };
}

export type TaxIdea = {
  title: string;
  plain: string;
  citation: string;
  basedOn: string[];
  lowCents: number | null;
  highCents: number | null;
  estimateNote: string;
};

const CONFIRM = "This is an estimate from the books, not tax advice. Confirm it with your CPA before you act.";

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function savingsIdeas(input: {
  entity: EntityTypeName;
  year: number;
  assets: { description: string; costCents: number; year: number; candidate: boolean }[];
  formulaVersions: number;
  qualifiedResearchCents: number;
  inventoryCents: number;
  openArCents: number;
  openApCents: number;
  salesTaxCollectedCents: number;
  customersMissingCert: number;
  customersExempt: number;
  retirementExpenseCents: number;
}): TaxIdea[] {
  const ideas: TaxIdea[] = [];
  const equipment = section179Range(input.assets, input.year);
  if (equipment.count > 0) {
    const names = input.assets.filter((asset) => asset.year === input.year && asset.candidate).map((asset) => asset.description);
    ideas.push({
      title: "Write off equipment you placed in service this year",
      plain: `You listed ${equipment.count} piece${equipment.count === 1 ? "" : "s"} of equipment placed in service in ${input.year}. Section 179 or 100% bonus depreciation may let you deduct qualifying equipment in that year. Use one of those, not both on the same dollars. Buy equipment because you need it.`,
      citation: "IRC section 179; IRC section 168(k); IRS Notice 2026-11; Form 4562. 2026 section 179 limit $2,560,000 (Publication 946).",
      basedOn: [`Equipment placed in service in ${input.year}: ${dollars(equipment.costCents)}`, ...names],
      lowCents: equipment.lowCents,
      highCents: equipment.highCents,
      estimateNote: `${CONFIRM} The high end is the cost, if every asset qualifies and business income is high enough. The low end is $0 if you do not elect it. SPIKE does not guess your tax rate.`,
    });
  }
  ideas.push({
    title: "Research credit for formulation work",
    plain: input.qualifiedResearchCents > 0
      ? "Some costs are tagged as research. The credit is a percentage of qualified research expenses, not of sales."
      : `SPIKE can see ${input.formulaVersions} formula version${input.formulaVersions === 1 ? "" : "s"}. It cannot see wages or supplies spent on that work, so it will not invent a credit.`,
    citation: "IRC section 41; Form 6765. The four-part test still has to be met.",
    basedOn: [`${input.formulaVersions} formula versions in the records`, input.qualifiedResearchCents > 0 ? "Research costs tagged in the books" : "No research wages or supplies are tagged"],
    lowCents: null,
    highCents: null,
    estimateNote: input.qualifiedResearchCents > 0
      ? `${CONFIRM} A dollar credit is not computed here. The regular credit and the alternative simplified credit are different, and your CPA has to choose.`
      : `${CONFIRM} No dollar estimate until qualified wages, supplies, or contract research are in the books.`,
  });
  if (input.inventoryCents > 0) {
    ideas.push({
      title: "Look at how inventory is valued",
      plain: "Inventory is valued at each lot's cost. A manufacturer sometimes has to add extra costs, such as some labor and overhead, into inventory. Changing the method is a formal request, not a year-end switch.",
      citation: "IRC sections 471 and 263A; Form 3115 if the method changes; Form 1125-A.",
      basedOn: [`Ending inventory at lot cost: ${dollars(input.inventoryCents)}`],
      lowCents: null,
      highCents: null,
      estimateNote: `${CONFIRM} No tax saving is estimated. Putting more cost into inventory can raise this year's profit.`,
    });
  }
  ideas.push({
    title: "Year-end timing",
    plain: "These books record income when you invoice, and supplier bills when you enter them. Collecting cash does not add the income a second time. Paying a bill you already entered does not create a second deduction. Do not hold back an invoice for goods you already shipped.",
    citation: "IRC section 451 (income) and section 461 (when a deduction is allowed). Accrual method.",
      basedOn: [`Customers still owe ${dollars(input.openArCents)}`, `Open supplier bills ${dollars(input.openApCents)}`],
    lowCents: null,
    highCents: null,
    estimateNote: `${CONFIRM} No extra deduction is estimated from paying bills you have already recorded.`,
  });
  ideas.push({
    title: "Sales tax certificates and manufacturing equipment",
    plain: "Ingredients bought to make goods for resale can be purchased with a Florida resale certificate. Machinery used in production may be exempt from Florida sales tax. Customers who claim an exemption need a current certificate on file.",
    citation: "Florida sections 212.07, 212.08(5), and 212.18, Florida Statutes; Form DR-13; Form DR-15.",
    basedOn: [`${input.customersExempt} customers marked exempt`, `${input.customersMissingCert} taxable customers with no certificate`],
    lowCents: null,
    highCents: null,
    estimateNote: `${CONFIRM} Supplier bills in SPIKE do not show sales tax charged by the vendor, so no refund amount is estimated.`,
  });
  if (input.retirementExpenseCents <= 0) {
    ideas.push({
      title: "Retirement plan contributions",
      plain: "No retirement-plan cost is in this year's expenses. A SEP IRA or 401(k) contribution can be deductible if the plan is set up in time and the money is sent by the deadline. Owner pay is not in these books, so SPIKE cannot size the contribution.",
      citation: "IRC section 404; Form 1120 or 1120-S deduction for the plan contribution.",
      basedOn: ["No retirement expense in the journal this year"],
      lowCents: null,
      highCents: null,
      estimateNote: `${CONFIRM} The dollar limit depends on pay, the plan, and the year. SPIKE will not guess it.`,
    });
  }
  if (input.salesTaxCollectedCents > 0) {
    const allowance = floridaCollectionAllowanceCents(input.salesTaxCollectedCents);
    ideas.push({
      title: "Florida collection allowance",
      plain: "If you file the DR-15 and pay electronically on time, Florida lets you keep a small collection allowance. It is 2.5% of the first $1,200 of tax due, and never more than $30. It is lost if the return is late.",
      citation: "Form DR-15, line 11; Florida DR-15 instructions (collection allowance).",
      basedOn: [`Sales tax on invoices this year: ${dollars(input.salesTaxCollectedCents)}`],
      lowCents: 0,
      highCents: allowance,
      estimateNote: `${CONFIRM} The high end uses tax collected in SPIKE for the whole year. A real DR-15 is usually monthly, and the allowance is per return, only when you e-file and e-pay on time.`,
    });
  }
  ideas.push({
    title: input.entity === "C_CORP" ? "Florida corporate tax" : "S corporation and Florida",
    plain: input.entity === "C_CORP"
      ? "A C corporation files Form 1120 for federal tax and may also file Florida Form F-1120. Florida has no personal income tax."
      : "An S corporation files Form 1120-S. Profit generally passes through to the owners. Florida has no personal income tax. Florida corporate tax can still apply in some cases.",
    citation: input.entity === "C_CORP" ? "Form 1120; Florida Form F-1120." : "Form 1120-S; Florida Form F-1120 instructions for S corporations.",
    basedOn: [input.entity === "C_CORP" ? "Company is set as a C corporation" : "Company is set as an S corporation"],
    lowCents: null,
    highCents: null,
    estimateNote: `${CONFIRM} SPIKE does not compute Florida corporate tax.`,
  });
  return ideas;
}

export function bookIncomeCents(lines: { accountType: AccountTypeName; cents: number }[]): number {
  const income = lines.filter((line) => line.accountType === "INCOME").reduce((sum, line) => sum + line.cents, 0);
  const cogs = lines.filter((line) => line.accountType === "COGS").reduce((sum, line) => sum + line.cents, 0);
  const expense = lines.filter((line) => line.accountType === "EXPENSE").reduce((sum, line) => sum + line.cents, 0);
  return income - cogs - expense;
}
