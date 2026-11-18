import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectImportKind, previewBundle, sortImportFiles, tieOut } from "@/lib/import-bundle";
import { xlsxToCsv } from "@/lib/xlsx-csv";

const empty = {
  peachtree: { partyCodes: [], partyNames: [], skus: ["RAW-1"], productNames: [], accountCodes: ["1000", "1100", "1200", "2000", "3900"] },
  golive: { skus: ["RAW-1"], partyCodes: ["CUT-1"], accountCodes: ["1000", "1100", "1200", "2000", "3900"], invoiceNumbers: [], billNumbers: [], lotNumbers: [], formulaSkus: [], bomOutputs: [], trialPosted: false },
};

describe("a drop of cutover files", () => {
  it("detects the kind and sorts into go-live order", () => {
    expect(detectImportKind(["Account ID", "Debit", "Credit"])).toBe("trial");
    expect(detectImportKind(["Customer ID", "Customer Name"])).toBe("customers");
    const sorted = sortImportFiles([
      { name: "b.csv", kind: "stock" },
      { name: "a.csv", kind: "customers" },
      { name: "c.csv", kind: "trial" },
    ]);
    expect(sorted.map((file) => file.kind)).toEqual(["customers", "trial", "stock"]);
  });

  it("names a bad row and checks the trial balance against stock, invoices, and bills", () => {
    const preview = previewBundle([
      { name: "trial.csv", csv: "Account ID,Debit,Credit\n1000,10.00,\n1100,25.00,\n1200,20.00,\n2000,,5.00\n3900,,50.00\n", kind: "trial" },
      { name: "stock.csv", csv: "Item ID,Quantity,Unit Cost,Lot Number\nRAW-1,10,2.00,OPEN-RAW-1\n", kind: "stock" },
      { name: "ar.csv", csv: "Customer ID,Invoice Number,Date,Amount\nCUT-1,PT-1,11/01/2026,25.00\nMISSING,PT-2,11/01/2026,1.00\n", kind: "ar" },
      { name: "ap.csv", csv: "Vendor ID,Bill Number,Date,Amount\nCUT-1,V-1,11/01/2026,5.00\n", kind: "ap" },
    ], empty);
    expect(preview.files.map((file) => file.kind)).toEqual(["trial", "stock", "ar", "ap"]);
    expect(preview.errorRows.map((row) => row.summary)).toContain("PT-2");
    expect(preview.checks.find((check) => check.name === "Trial balance")?.ok).toBe(true);
    expect(preview.checks.find((check) => check.name === "Stock and inventory accounts")?.ok).toBe(true);
    expect(preview.checks.find((check) => check.name === "Open invoices and account 1100")?.ok).toBe(true);
    expect(preview.checks.find((check) => check.name === "Open bills and account 2000")?.ok).toBe(true);
    const off = tieOut({
      trial: [{ accountCode: "1100", debitCents: 100, creditCents: 0 }, { accountCode: "3900", debitCents: 0, creditCents: 100 }],
      stockCents: null,
      arCents: 50,
      apCents: null,
    });
    expect(off.find((check) => check.name === "Open invoices and account 1100")?.ok).toBe(false);
  });

  it("reads the first sheet of an Excel file as CSV", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Customer ID", "Customer Name"], ["CUT-1", "Cutover"]]);
    XLSX.utils.book_append_sheet(book, sheet, "Customers");
    const csv = xlsxToCsv(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })));
    expect(detectImportKind(csv.split("\n")[0].split(","))).toBe("customers");
  });
});
