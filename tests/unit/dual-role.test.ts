import { describe, expect, it } from "vitest";
import { booksAgree } from "@/lib/books";
import { validateOpenAp, validateOpenAr } from "@/lib/golive";
import { previewBundle } from "@/lib/import-bundle";
import { nameKey } from "@/lib/names";
import { validateCustomers } from "@/lib/peachtree";

const keys = {
  partyCodes: ["CHEMSOL-LLC"],
  partyNames: [nameKey("Chemsol LLC")],
  parties: [{ code: "CHEMSOL-LLC", nameKey: nameKey("Chemsol LLC"), isCustomer: true, isVendor: false }],
  skus: [],
  productNames: [],
  accountCodes: ["1100", "2000", "3900"],
};

describe("one company, both roles", () => {
  it("adds the vendor role onto an existing customer and does not reject the ID", () => {
    const preview = validateCustomers(
      [{ "Vendor ID": "CHEMSOL-LLC", "Vendor Name": "Chemsol LLC", "Bill to City": "Tampa", Terms: "Net 45", "1099": "NEC", "Telephone 1": "727-555-0100" }],
      keys,
      true,
    );
    expect(preview.rows[0].status).toBe("role added");
    expect(preview.ready[0]).toMatchObject({ action: "add-role", code: "CHEMSOL-LLC", paymentTermsDays: 45, infoReturn: "NEC", phone: "727-555-0100" });
  });

  it("adds the customer role onto an existing vendor", () => {
    const preview = validateCustomers(
      [{ "Customer ID": "ENGLOSOL", "Customer Name": "Englosol" }],
      { ...keys, partyCodes: ["ENGLOSOL"], partyNames: [nameKey("Englosol")], parties: [{ code: "ENGLOSOL", nameKey: nameKey("Englosol"), isCustomer: false, isVendor: true }] },
      false,
    );
    expect(preview.rows[0].status).toBe("role added");
    expect(preview.ready[0].action).toBe("add-role");
  });

  it("treats a second import of the same role as already done", () => {
    const preview = validateCustomers(
      [{ "Vendor ID": "CHEMSOL-LLC", "Vendor Name": "Chemsol LLC" }],
      { ...keys, parties: [{ code: "CHEMSOL-LLC", nameKey: nameKey("Chemsol LLC"), isCustomer: true, isVendor: true }] },
      true,
    );
    expect(preview.rows[0].status).toBe("ok");
    expect(preview.ready).toEqual([]);
    expect(preview.rows[0].messages.join(" ")).toMatch(/Already a vendor/);
  });

  it("keeps what they owe us separate from what we owe them", () => {
    const open = { skus: [], partyCodes: ["CHEMSOL-LLC"], accountCodes: ["1100", "2000"], invoiceNumbers: [], billNumbers: [], lotNumbers: [], formulaSkus: [], bomOutputs: [], trialPosted: false };
    expect(validateOpenAr([{ "Customer ID": "CHEMSOL-LLC", "Invoice Number": "PT-1", Date: "11/01/2026", Amount: "80.00" }], open).ready[0].amountCents).toBe(8000);
    expect(validateOpenAp([{ "Vendor ID": "CHEMSOL-LLC", "Bill Number": "V-9", Date: "11/01/2026", Amount: "30.00" }], open).ready[0].amountCents).toBe(3000);
    const tied = booksAgree({ trialDebit: 11000, trialCredit: 11000, arGl: 8000, arSub: 8000, apGl: 3000, apSub: 3000, inventoryGl: 0, inventoryLots: 0 });
    expect(tied.ok).toBe(true);
    const arOff = booksAgree({ trialDebit: 11000, trialCredit: 11000, arGl: 8000, arSub: 11000, apGl: 3000, apSub: 3000, inventoryGl: 0, inventoryLots: 0 });
    expect(arOff.problems.join(" ")).toMatch(/Customers owe/);
    expect(arOff.problems.join(" ")).not.toMatch(/We owe/);
  });

  it("reports role added when a vendor file follows the same customer in one drop", () => {
    const preview = previewBundle(
      [
        { name: "customers.csv", kind: "customers", csv: "Customer ID,Customer Name\nCHEMSOL-LLC,Chemsol LLC\n" },
        { name: "vendors.csv", kind: "vendors", csv: "Vendor ID,Vendor Name,Terms\nCHEMSOL-LLC,Chemsol LLC,Net 45\n" },
      ],
      {
        peachtree: { partyCodes: [], partyNames: [], skus: [], productNames: [], accountCodes: [] },
        golive: { skus: [], partyCodes: [], accountCodes: [], invoiceNumbers: [], billNumbers: [], lotNumbers: [], formulaSkus: [], bomOutputs: [], trialPosted: false },
      },
    );
    expect(preview.roleRows).toHaveLength(1);
    expect(preview.roleRows[0].status).toBe("role added");
    expect(preview.errorRows).toEqual([]);
  });
});
