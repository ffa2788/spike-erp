import { describe, expect, it } from "vitest";
import { CODES } from "@/lib/chart";
import { detectGolive, validateFormulas, validateOpenAr, validateTrial } from "@/lib/golive";
import { formatSequence } from "@/lib/services/shared";

const empty = {
  skus: ["RAW-1", "FIN-1"],
  partyCodes: ["CUT-1"],
  accountCodes: ["1000", "1100", "1200", "2000", "3900"],
  invoiceNumbers: [],
  billNumbers: [],
  lotNumbers: [],
  formulaSkus: [],
  bomOutputs: [],
  trialPosted: false,
};

describe("go-live files", () => {
  it("recognizes a trial balance and refuses one that does not balance or skips opening equity", () => {
    expect(detectGolive(["Account ID", "Debit", "Credit"])).toBe("trial");
    const bad = validateTrial(
      [
        { "Account ID": "1000", Debit: "10.00", Credit: "" },
        { "Account ID": "3900", Debit: "", Credit: "9.00" },
      ],
      empty,
    );
    expect(bad.ready).toEqual([]);
    expect(bad.rows[0].messages.join(" ")).toMatch(/does not balance/);
    const noPlug = validateTrial(
      [
        { "Account ID": "1000", Debit: "10.00", Credit: "" },
        { "Account ID": "2000", Debit: "", Credit: "10.00" },
      ],
      empty,
    );
    expect(noPlug.ready).toEqual([]);
    expect(noPlug.rows[0].messages.join(" ")).toMatch(new RegExp(CODES.obe));
    const good = validateTrial(
      [
        { "Account ID": "1000", Debit: "10.00", Credit: "" },
        { "Account ID": "3900", Debit: "", Credit: "10.00" },
      ],
      empty,
    );
    expect(good.ready).toHaveLength(2);
  });

  it("keeps an open invoice from being loaded twice and requires the percents to add to 100", () => {
    const again = validateOpenAr(
      [{ "Customer ID": "CUT-1", "Invoice Number": "PT-1", Date: "11/01/2026", Amount: "25.00" }],
      { ...empty, invoiceNumbers: ["PT-1"] },
    );
    expect(again.ready).toEqual([]);
    const formula = validateFormulas(
      [
        { "Finished SKU": "FIN-1", "Ingredient SKU": "RAW-1", Percent: "80" },
        { "Finished SKU": "FIN-1", "Ingredient SKU": "RAW-1", Percent: "10" },
      ],
      empty,
    );
    expect(formula.ready).toEqual([]);
    expect(formula.rows[0].messages.join(" ")).toMatch(/100%/);
  });

  it("pads export invoice numbers the same way as the other prefixes", () => {
    expect(formatSequence("invoice-E", 1)).toBe("E-000001");
    expect(formatSequence("invoice-S", 1)).toBe("S-000001");
  });
});
