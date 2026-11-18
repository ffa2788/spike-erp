import { describe, expect, it } from "vitest";
import {
  federalReturnLines,
  floridaCollectionAllowanceCents,
  floridaDr15,
  infoReturnThresholdCents,
  savingsIdeas,
  section179Range,
  vendorInfoReturns,
} from "@/lib/tax-center";

describe("Florida DR-15 worksheet", () => {
  const invoices = [
    {
      issuedOn: "2026-11-03",
      locality: "Pinellas",
      subtotalCents: 100_000,
      taxableCents: 0,
      taxCents: 0,
      exemptionApplied: true,
      lines: [{ amountCents: 100_000, taxable: true }],
      countyRateBps: 100,
    },
    {
      issuedOn: "2026-11-04",
      locality: "Pinellas",
      subtotalCents: 700_000,
      taxableCents: 700_000,
      taxCents: 47_000,
      exemptionApplied: false,
      lines: [{ amountCents: 700_000, taxable: true }],
      countyRateBps: 100,
    },
    {
      issuedOn: "2026-11-12",
      locality: "Hillsborough",
      subtotalCents: 200_000,
      taxableCents: 200_000,
      taxCents: 15_000,
      exemptionApplied: false,
      lines: [{ amountCents: 200_000, taxable: true }],
      countyRateBps: 150,
    },
  ];

  it("splits exempt sales, the $5,000 surtax cap, and county surtax", () => {
    const sheet = floridaDr15(invoices, "November 2026");
    expect(sheet.grossSalesCents).toBe(1_000_000);
    expect(sheet.exemptSalesCents).toBe(100_000);
    expect(sheet.taxableAmountCents).toBe(900_000);
    expect(sheet.stateTaxCents).toBe(Math.round(700_000 * 0.06) + Math.round(200_000 * 0.06));
    expect(sheet.overCapCents).toBe(200_000);
    expect(sheet.surtaxCents).toBe(Math.round(500_000 * 0.01) + Math.round(200_000 * 0.015));
    expect(sheet.taxDueCents).toBe(sheet.stateTaxCents + sheet.surtaxCents);
    expect(sheet.collectedTaxCents).toBe(62_000);
    expect(sheet.counties.map((row) => row.county)).toEqual(["Hillsborough", "Pinellas"]);
    expect(sheet.collectionAllowanceCents).toBe(1_550);
  });

  it("caps the collection allowance at $30", () => {
    expect(floridaCollectionAllowanceCents(0)).toBe(0);
    expect(floridaCollectionAllowanceCents(40_000)).toBe(1_000);
    expect(floridaCollectionAllowanceCents(120_000)).toBe(3_000);
    expect(floridaCollectionAllowanceCents(500_000)).toBe(3_000);
  });
});

describe("1099 vendor totals", () => {
  it("uses $2,000 for 2026 and $600 before that", () => {
    expect(infoReturnThresholdCents(2026)).toBe(200_000);
    expect(infoReturnThresholdCents(2025)).toBe(60_000);
    const rows = vendorInfoReturns(
      [
        { name: "Goods Co", paidCents: 500_000, w9OnFile: true, infoReturn: "NONE" },
        { name: "Small shop", paidCents: 90_000, w9OnFile: false, infoReturn: "NEC" },
        { name: "Repair shop", paidCents: 250_000, w9OnFile: false, infoReturn: "NEC" },
        { name: "Landlord", paidCents: 200_000, w9OnFile: true, infoReturn: "MISC" },
      ],
      2026,
    );
    expect(rows.find((row) => row.name === "Goods Co")?.file).toBe(false);
    expect(rows.find((row) => row.name === "Small shop")).toMatchObject({ file: false, needsW9: true });
    expect(rows.find((row) => row.name === "Repair shop")).toMatchObject({ file: true, form: "1099-NEC", needsW9: true });
    expect(rows.find((row) => row.name === "Repair shop")?.reason).toMatch(/3406/);
    expect(rows.find((row) => row.name === "Landlord")).toMatchObject({ file: true, form: "1099-MISC", needsW9: false });
  });
});

describe("federal return lines", () => {
  const income = [
    { name: "Product sales", cents: 179_000 },
    { name: "Other income", cents: 1_000 },
  ];
  const cogs = [{ name: "Cost of goods sold", cents: 40_000 }];
  const expense = [{ name: "Bank fees", cents: 1_500 }];

  it("maps the same book profit to 1120 or 1120-S", () => {
    const corp = federalReturnLines({
      entity: "C_CORP",
      income,
      cogs,
      expense,
      inventoryCents: 1_000_000,
      equipmentListCents: 850_000,
      equipmentBookCents: 850_000,
    });
    const s = federalReturnLines({
      entity: "S_CORP",
      income,
      cogs,
      expense,
      inventoryCents: 1_000_000,
      equipmentListCents: 850_000,
      equipmentBookCents: 850_000,
    });
    expect(corp.bookIncomeCents).toBe(179_000 + 1_000 - 40_000 - 1_500);
    expect(s.bookIncomeCents).toBe(corp.bookIncomeCents);
    expect(corp.lines[0].formLine).toMatch(/1120, line 1a/);
    expect(s.lines[0].formLine).toMatch(/1120-S, line 1a/);
    expect(s.lines.find((line) => line.formLine.includes("line 21"))?.cents).toBe(corp.bookIncomeCents);
    expect(corp.lines.find((line) => line.formLine.includes("1125-A"))?.cents).toBe(1_000_000);
  });
});

describe("savings ideas", () => {
  const base = {
    entity: "S_CORP" as const,
    year: 2026,
    assets: [{ description: "Example tote filler", costCents: 850_000, year: 2026, candidate: true }],
    formulaVersions: 4,
    qualifiedResearchCents: 0,
    inventoryCents: 1_500_000,
    openArCents: 40_000,
    openApCents: 0,
    salesTaxCollectedCents: 12_000,
    customersMissingCert: 1,
    customersExempt: 2,
    retirementExpenseCents: 0,
  };

  it("limits section 179 to the 2026 dollar cap and phaseout", () => {
    expect(section179Range(base.assets, 2026)).toEqual({ count: 1, costCents: 850_000, lowCents: 0, highCents: 850_000 });
    const huge = section179Range([{ costCents: 500_000_000, year: 2026, candidate: true }], 2026);
    expect(huge.highCents).toBe(256_000_000 - (500_000_000 - 409_000_000));
    expect(section179Range([{ costCents: 850_000, year: 2025, candidate: true }], 2026).highCents).toBe(0);
  });

  it("cites the code, labels the range as an estimate, and does not invent a research credit", () => {
    const ideas = savingsIdeas(base);
    const equipment = ideas.find((idea) => idea.title.includes("equipment"));
    expect(equipment?.citation).toMatch(/section 179/);
    expect(equipment?.citation).toMatch(/168\(k\)/);
    expect(equipment?.lowCents).toBe(0);
    expect(equipment?.highCents).toBe(850_000);
    expect(equipment?.estimateNote.toLowerCase()).toMatch(/estimate/);
    expect(equipment?.estimateNote).toMatch(/CPA/);
    const research = ideas.find((idea) => idea.title.includes("Research"));
    expect(research?.lowCents).toBeNull();
    expect(research?.highCents).toBeNull();
    expect(research?.citation).toMatch(/section 41/);
    const timing = ideas.find((idea) => idea.title.includes("Year-end"));
    expect(timing?.plain).toMatch(/Do not hold back an invoice/);
    expect(timing?.basedOn.join(" ")).toMatch(/\$400\.00/);
    expect(ideas.every((idea) => idea.estimateNote.includes("CPA"))).toBe(true);
    expect(ideas.find((idea) => idea.title.includes("collection"))?.highCents).toBe(300);
  });
});
