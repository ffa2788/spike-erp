import { describe, expect, it } from "vitest";
import { journalProblem } from "@/lib/journals";
import { calculatePay, postingBlock, payrollJournal, quarterlyPayroll, type PayrollTable } from "@/lib/payroll";
import { pathShowsFormula, pathSteps } from "@/lib/product-path";
import { DEMO_USERS } from "@/lib/demo-auth";
import { SHARED_NAV } from "@/lib/roles";
import { buildPlan, parsePulls, planEmailHtml, planPlainText, wholeUnits } from "@/lib/work-list-mail";
import { channelPrefix } from "@/lib/commercial";

const table: PayrollTable = {
  reviewed: false,
  socialSecurityBps: 620,
  socialSecurityWageBaseCents: 10_000_00,
  medicareBps: 145,
  futaBps: 60,
  futaWageBaseCents: 7_000_00,
  floridaBps: 270,
  floridaWageBaseCents: 7_000_00,
};

describe("roles, product paths, export, and payroll", () => {
  it("gives FFA and Chris one menu, and Trevor no login", () => {
    const hrefs = SHARED_NAV.flatMap((group) => group.links.map((link) => link.href));
    expect(hrefs).toContain("/payroll");
    expect(hrefs).toContain("/production");
    expect(hrefs).toContain("/tax");
    expect(DEMO_USERS.map((user) => user.name)).toEqual(["FFA", "Chris"]);
  });

  it("builds a production plan with separate material rows and a whole-unit packaging list", () => {
    const pulls = parsePulls("Example 1 gal jug: 0.2 each (short 0.2)\nPhosphoric acid 75%: 0.4 lb");
    expect(pulls.map((item) => item.name)).toEqual(["1 gal jug", "Phosphoric acid 75%"]);
    expect(wholeUnits(0.0278)).toBe(1);
    const plan = buildPlan({
      number: "WK-1001",
      weekOf: "2026-11-16",
      releasedOn: "2026-11-16",
      releasedBy: "FFA",
      lines: [
        { dueOn: "2026-11-17", sku: "RUST-1G", name: "SPER Rust Preventer", packageLabel: "1 gal", qty: 4, fbaQty: 0, unit: "each", formulaVersion: 1, daysCover: 0, shortage: true, materials: JSON.stringify(pulls) },
        { dueOn: "2026-11-18", sku: "POLY-BEAD", name: "SPER PolyPhos beads", packageLabel: "Bulk", qty: 0, fbaQty: 0, unit: "lb", formulaVersion: 1, daysCover: 20, shortage: false, materials: "" },
      ],
    });
    expect(plan.jobs).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.makeLabel).toBe("4 gal");
    expect(plan.packagingPicks[0].qty).toBe(1);
    const text = planPlainText(plan);
    expect(text).toContain("Material  Phosphoric acid 75%");
    expect(text).not.toContain("jug: 0.2");
    const html = planEmailHtml(plan);
    expect(html).toContain("Production Plan, Week of");
    expect(html).toContain("Material short");
    expect(html).not.toContain("<pre>");
  });

  it("uses the product path to decide whether a formula is required", () => {
    expect(pathSteps("RESALE").map((step) => step.title)).toEqual(["Buy", "Sell as-is"]);
    expect(pathShowsFormula("RESALE")).toBe(false);
    expect(pathShowsFormula("REPACK")).toBe(false);
    expect(pathSteps("MANUFACTURED").map((step) => step.title)).toEqual(["Buy", "Make", "Pack", "Sell"]);
  });

  it("numbers export invoices with E- and does not use S-", () => {
    expect(channelPrefix("EXPORT")).toBe("E");
    expect(channelPrefix("DIRECT")).toBe("S");
  });

  it("calculates Florida payroll from the table and blocks posting until review", () => {
    const pay = calculatePay(table, { grossCents: 1_000_00, ytdGrossBeforeCents: 0, federalWithholdingBps: 1000, mode: "CALCULATOR" });
    expect(pay.socialSecurityCents).toBe(62_00);
    expect(pay.medicareCents).toBe(14_50);
    expect(pay.federalWithholdingCents).toBe(100_00);
    expect(pay.futaCents).toBe(6_00);
    expect(pay.floridaCents).toBe(27_00);
    expect(pay.netCents).toBe(1_000_00 - 100_00 - 62_00 - 14_50);
    const overBase = calculatePay(table, { grossCents: 1_000_00, ytdGrossBeforeCents: 10_000_00, federalWithholdingBps: 0, mode: "CALCULATOR" });
    expect(overBase.socialSecurityCents).toBe(0);
    expect(postingBlock(table, "CALCULATOR")).toMatch(/accountant/);
    expect(postingBlock({ reviewed: true }, "CALCULATOR")).toBeNull();
    expect(postingBlock(table, "PROVIDER")).toBeNull();
    expect(journalProblem(payrollJournal([pay]))).toBeNull();
  });

  it("summarizes a quarter for 941, 940, and RT-6", () => {
    const pay = calculatePay({ ...table, reviewed: true }, { grossCents: 2_000_00, ytdGrossBeforeCents: 0, federalWithholdingBps: 0, mode: "CALCULATOR" });
    const report = quarterlyPayroll(2026, 1, [{ ...pay, payDate: "2026-01-31" }, { ...pay, payDate: "2026-04-15" }]);
    expect(report.form941.wagesCents).toBe(2_000_00);
    expect(report.form940.yearToDateFutaCents).toBe(pay.futaCents);
    expect(report.rt6.taxCents).toBe(pay.floridaCents);
    expect(report.form941.wagesCents).not.toBe(4_000_00);
  });
});
