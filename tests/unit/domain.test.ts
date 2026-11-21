import { describe, expect, it } from "vitest";
import { agingBucket, summarizeAging } from "@/lib/aging";
import { explainBank, suggestBankMatches } from "@/lib/bank";
import { booksAgree } from "@/lib/books";
import { CODES } from "@/lib/chart";
import { percentsBalance, rollUpCost } from "@/lib/costing";
import { parseCsv } from "@/lib/csv";
import { descendantLotIds, traceBackward } from "@/lib/genealogy";
import { buildLotBalances, fefoAllocate, reliefCents, valueCents } from "@/lib/inventory";
import {
  balanceSheet,
  cogsJournal,
  finishJournal,
  journalProblem,
  openingJournal,
  profitAndLoss,
  receiptJournal,
  salesJournal,
  trialBalance,
  vendorBillJournal,
  type PostedLine,
} from "@/lib/journals";
import { isLocked } from "@/lib/lockout";
import { nameKey } from "@/lib/names";
import { shipBlockReason } from "@/lib/nsf";
import { validateAmazonOrders } from "@/lib/amazon";
import { detectKind, validateCustomers, validateItems, validateJournal } from "@/lib/peachtree";
import { can } from "@/lib/permissions";
import { reorderSuggestion } from "@/lib/planning";
import { buyPriceProblem, priceStatusOf, sellBlockReason } from "@/lib/pricing";
import { buildSalesReport } from "@/lib/sales-report";
import { buildAttention } from "@/lib/attention";
import { computeSalesTax } from "@/lib/tax";

const emptyKeys = { partyCodes: [], partyNames: [], skus: [], productNames: [], accountCodes: ["1000", "3900", "6200"] };

describe("recipe cost", () => {
  const products = [
    { id: "acid", sku: "PA-75", name: "Phosphoric acid", kind: "RAW" as const, standardCost: 0.48 },
    { id: "shmp", sku: "SHMP", name: "Sodium hexametaphosphate", kind: "RAW" as const, standardCost: 0.92 },
    { id: "water", sku: "WATER", name: "Deionized water", kind: "UTILITY" as const, standardCost: 0.02 },
    { id: "zinc", sku: "ZINC", name: "Zinc chloride", kind: "RAW" as const, standardCost: 1.15 },
    { id: "missing", sku: "GAP", name: "Unpriced ingredient", kind: "RAW" as const, standardCost: 0 },
    { id: "poly", sku: "POLY", name: "PolyPhos liquid", kind: "FINISHED" as const, standardCost: 0.01 },
    { id: "child", sku: "CHILD", name: "Hyperion blend", kind: "FINISHED" as const, standardCost: 9 },
    { id: "parent", sku: "PARENT", name: "Rust preventer", kind: "FINISHED" as const, standardCost: 9 },
  ];

  it("rolls a sub-recipe into the parent", () => {
    const formulas = [
      {
        productId: "poly",
        isDefault: true,
        lines: [
          { ingredientId: "shmp", percent: 35 },
          { ingredientId: "acid", percent: 15 },
          { ingredientId: "water", percent: 50 },
        ],
      },
      {
        productId: "parent",
        isDefault: true,
        lines: [
          { ingredientId: "poly", percent: 70 },
          { ingredientId: "zinc", percent: 10 },
          { ingredientId: "water", percent: 20 },
        ],
      },
    ];
    const poly = rollUpCost("poly", products, formulas);
    expect(poly.status).toBe("OK");
    expect(poly.costPerUnit).toBeCloseTo(0.404, 6);
    const parent = rollUpCost("parent", products, formulas);
    expect(parent.status).toBe("OK");
    expect(parent.costPerUnit).toBeCloseTo(0.7 * 0.404 + 0.1 * 1.15 + 0.2 * 0.02, 6);
    expect(parent.costPerUnit).not.toBe(9);
  });

  it("refuses a partial cost when a sub-recipe is incomplete", () => {
    const formulas = [
      {
        productId: "child",
        isDefault: true,
        lines: [
          { ingredientId: "acid", percent: 50 },
          { ingredientId: "missing", percent: 50 },
        ],
      },
      {
        productId: "parent",
        isDefault: true,
        lines: [
          { ingredientId: "child", percent: 70 },
          { ingredientId: "zinc", percent: 30 },
        ],
      },
    ];
    const parent = rollUpCost("parent", products, formulas);
    expect(parent.status).toBe("INCOMPLETE");
    expect(parent.costPerUnit).toBeNull();
    expect(parent.breakdown.find((line) => line.ingredientId === "child")?.contribution).toBeNull();
    expect(parent.breakdown.find((line) => line.ingredientId === "zinc")?.contribution).toBeCloseTo(0.345, 6);
  });

  it("does not fall back to a stored cost when the formula is missing", () => {
    const rolled = rollUpCost("poly", products, []);
    expect(rolled.status).toBe("NO_FORMULA");
    expect(rolled.costPerUnit).toBeNull();
  });

  it("stops a formula loop", () => {
    const formulas = [
      { productId: "poly", isDefault: true, lines: [{ ingredientId: "parent", percent: 100 }] },
      { productId: "parent", isDefault: true, lines: [{ ingredientId: "poly", percent: 100 }] },
    ];
    const rolled = rollUpCost("parent", products, formulas);
    expect(rolled.status).toBe("INCOMPLETE");
    expect(rolled.costPerUnit).toBeNull();
    expect(rolled.problems.join(" ")).toMatch(/loops/i);
  });

  it("requires 100 percent", () => {
    expect(percentsBalance([35, 15, 50])).toBe(true);
    expect(percentsBalance([33.33, 33.33, 33.33])).toBe(false);
  });
});

describe("prices", () => {
  it("blocks a blank or one-dollar selling price", () => {
    expect(priceStatusOf(null, false)).toBe("UNSET");
    expect(priceStatusOf(1, false)).toBe("PLACEHOLDER");
    expect(priceStatusOf(1, true)).toBe("CONFIRMED");
    expect(priceStatusOf(2.4, false)).toBe("CONFIRMED");
    expect(
      sellBlockReason({ active: true, sellable: true, priceStatus: "PLACEHOLDER", listPrice: 1 }),
    ).toMatch(/placeholder/i);
    expect(buyPriceProblem(1, false)).toMatch(/\$1\.00/);
    expect(buyPriceProblem(0.48, false)).toBeNull();
  });
});

describe("inventory", () => {
  const locations = [
    { id: "main", code: "MAIN", shippable: true },
    { id: "qc", code: "QC", shippable: false },
  ];
  const lots = [
    {
      id: "old",
      lotNumber: "L-OLD",
      productId: "p",
      qcStatus: "APPROVED" as const,
      expiresOn: "2026-12-01",
      receivedOn: "2026-01-01",
      unitCost: 0.5,
      formulaVersion: 1,
      nsfEligible: true,
    },
    {
      id: "new",
      lotNumber: "L-NEW",
      productId: "p",
      qcStatus: "APPROVED" as const,
      expiresOn: "2027-06-01",
      receivedOn: "2026-02-01",
      unitCost: 0.5,
      formulaVersion: 1,
      nsfEligible: true,
    },
    {
      id: "hold",
      lotNumber: "L-HOLD",
      productId: "p",
      qcStatus: "QUARANTINE" as const,
      expiresOn: "2026-11-01",
      receivedOn: "2026-01-01",
      unitCost: 0.5,
      formulaVersion: 1,
      nsfEligible: false,
    },
  ];
  const balances = buildLotBalances({
    lots,
    locations,
    movements: [
      { lotId: "old", locationId: "main", qty: 10 },
      { lotId: "new", locationId: "main", qty: 10 },
      { lotId: "hold", locationId: "qc", qty: 40 },
    ],
  });

  it("picks the earliest expiry and skips quarantine", () => {
    const picked = fefoAllocate(balances, "p", 12, "2026-11-14");
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.picks.map((pick) => pick.lotNumber)).toEqual(["L-OLD", "L-NEW"]);
    expect(picked.picks[0].qty).toBe(10);
    expect(picked.picks[1].qty).toBe(2);
    expect(picked.available).toBe(20);
  });

  it("skips expired lots", () => {
    const picked = fefoAllocate(balances, "p", 5, "2026-12-15");
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.picks.map((pick) => pick.lotNumber)).toEqual(["L-NEW"]);
  });

  it("keeps lot value and relief in whole cents", () => {
    expect(valueCents(0.999, 0.1)).toBe(10);
    const first = reliefCents(0.999, 0.666, 0.1);
    const second = reliefCents(0.666, 0.333, 0.1);
    const third = reliefCents(0.333, 0, 0.1);
    expect(first + second + third).toBe(10);
  });
});

describe("NSF shipping gate", () => {
  const product = {
    name: "PolyPhos",
    nsfCertified: true,
    nsfExpiresOn: "2027-01-01",
    nsfFormulaVersion: 1,
  };
  const lot = {
    lotNumber: "L-1",
    qcStatus: "APPROVED",
    nsfEligible: true,
    formulaVersion: 1,
    expiresOn: null,
  };

  it("allows a released certified lot", () => {
    expect(shipBlockReason(product, lot, "2026-11-14")).toBeNull();
  });

  it("blocks an expired certificate, a wrong formula, and a lot still in quarantine", () => {
    expect(shipBlockReason({ ...product, nsfExpiresOn: "2026-01-01" }, lot, "2026-11-14")).toMatch(/expired/i);
    expect(shipBlockReason(product, { ...lot, formulaVersion: 2 }, "2026-11-14")).toMatch(/formula version/i);
    expect(shipBlockReason(product, { ...lot, qcStatus: "QUARANTINE" }, "2026-11-14")).toMatch(/not released/i);
  });
});

describe("sales tax", () => {
  const rates = [
    { state: "FL", locality: "", name: "Florida state", rateBps: 600, active: true },
    { state: "FL", locality: "Pinellas", name: "Pinellas surtax", rateBps: 100, active: true },
  ];

  it("stacks state and local rates", () => {
    const tax = computeSalesTax({
      shipState: "FL",
      taxLocality: "Pinellas",
      rates,
      lines: [{ amountCents: 100000, taxable: true }],
      exempt: false,
      exemptionExpires: null,
      exemptionState: null,
      asOf: "2026-11-14",
    });
    expect(tax.taxCents).toBe(7000);
    expect(tax.breakdown).toHaveLength(2);
  });

  it("honors a live certificate and ignores an expired one", () => {
    const base = {
      shipState: "FL",
      taxLocality: "Pinellas",
      rates,
      lines: [{ amountCents: 10000, taxable: true }],
      exempt: true,
      exemptionState: "FL",
      asOf: "2026-11-14",
    };
    expect(computeSalesTax({ ...base, exemptionExpires: "2027-01-01" }).taxCents).toBe(0);
    const expired = computeSalesTax({ ...base, exemptionExpires: "2026-01-01" });
    expect(expired.taxCents).toBe(700);
    expect(expired.warning).toMatch(/expired/i);
  });
});

describe("journals and statements", () => {
  it("builds balanced operational entries", () => {
    expect(journalProblem(salesJournal({ subtotalCents: 10000, taxCents: 700, totalCents: 10700 }))).toBeNull();
    expect(journalProblem(salesJournal({ subtotalCents: 5000, taxCents: 0, totalCents: 5000, feeCents: 800 }))).toBeNull();
    expect(journalProblem(cogsJournal(3200))).toBeNull();
    expect(journalProblem(receiptJournal([{ accountCode: CODES.invRaw, cents: 4800 }]))).toBeNull();
    expect(journalProblem(vendorBillJournal(4800, 5000))).toBeNull();
    expect(journalProblem(vendorBillJournal(4800, 4700))).toBeNull();
    expect(journalProblem(finishJournal({ wipCents: 100, utilityCents: 0, fgCents: 99 }))).toBeNull();
    expect(journalProblem(openingJournal({ cashCents: 100, rawCents: 50, fgCents: 25 }))).toBeNull();
  });

  it("keeps the balance sheet equal to liabilities, equity, and earnings", () => {
    const accounts = {
      [CODES.cash]: ["Cash", "ASSET"],
      [CODES.ar]: ["AR", "ASSET"],
      [CODES.invFg]: ["FG", "ASSET"],
      [CODES.tax]: ["Tax", "LIABILITY"],
      [CODES.obe]: ["Opening", "EQUITY"],
      [CODES.sales]: ["Sales", "INCOME"],
      [CODES.cogs]: ["COGS", "COGS"],
    } as const;
    const add = (date: string, lines: { code: string; debit: number; credit: number }[]): PostedLine[] =>
      lines.map((line) => ({
        accountCode: line.code,
        accountName: accounts[line.code as keyof typeof accounts][0],
        accountType: accounts[line.code as keyof typeof accounts][1] as PostedLine["accountType"],
        debitCents: line.debit,
        creditCents: line.credit,
        date,
      }));
    const posted = [
      ...add("2026-10-01", [
        { code: CODES.cash, debit: 50000, credit: 0 },
        { code: CODES.invFg, debit: 20000, credit: 0 },
        { code: CODES.obe, debit: 0, credit: 70000 },
      ]),
      ...add("2026-11-02", [
        { code: CODES.ar, debit: 10700, credit: 0 },
        { code: CODES.sales, debit: 0, credit: 10000 },
        { code: CODES.tax, debit: 0, credit: 700 },
        { code: CODES.cogs, debit: 4000, credit: 0 },
        { code: CODES.invFg, debit: 0, credit: 4000 },
      ]),
      ...add("2026-11-03", [
        { code: CODES.cash, debit: 10700, credit: 0 },
        { code: CODES.ar, debit: 0, credit: 10700 },
      ]),
    ];
    expect(trialBalance(posted).balanced).toBe(true);
    const pl = profitAndLoss(posted, "2026-11-01", "2026-11-30");
    expect(pl.profitCents).toBe(6000);
    const bs = balanceSheet(posted, "2026-11-30");
    expect(bs.assets.totalCents).toBe(76700);
    expect(bs.balanced).toBe(true);
    expect(bs.earningsCents).toBe(6000);
  });
});

describe("planning, aging, bank, and reports", () => {
  it("suggests a buy from demand, stock, and open purchase orders", () => {
    const suggestion = reorderSuggestion({
      minQty: 100,
      openSalesQty: 200,
      availableQty: 50,
      openPoQty: 30,
      unit: "lb",
    });
    expect(suggestion.buyQty).toBe(120);
    expect(reorderSuggestion({ minQty: 100, openSalesQty: 0, availableQty: 150, openPoQty: 0, unit: "lb" }).buyQty).toBe(0);
  });

  it("ages receivables from the due date", () => {
    expect(agingBucket("2026-11-20", "2026-11-14")).toBe("current");
    expect(agingBucket("2026-10-01", "2026-11-14")).toBe("31-60");
    const summary = summarizeAging(
      [{ id: "1", number: "INV-1", name: "City", balanceCents: 500, due: "2026-08-01" }],
      "2026-11-14",
    );
    expect(summary.buckets["over-90"]).toBe(500);
    expect(summary.totalCents).toBe(500);
  });

  it("explains a bank difference that is only a fee", () => {
    const pairs = suggestBankMatches(
      [
        { id: "dep", amountCents: 155000, date: "2026-11-03", matched: false },
        { id: "chk", amountCents: -92000, date: "2026-11-04", matched: false },
        { id: "fee", amountCents: -1500, date: "2026-11-05", matched: false },
      ],
      [
        { id: "pmt", amountCents: 155000, date: "2026-11-03", matched: false },
        { id: "vpay", amountCents: -92000, date: "2026-11-04", matched: false },
      ],
    );
    expect(pairs).toHaveLength(2);
    const explained = explainBank({
      bookCashCents: 7563000,
      statementEndingCents: 7561500,
      bookNotOnStatementCents: 0,
      statementNotInBooksCents: -1500,
      openBookCents: 63000,
      openStatementCents: 61500,
    });
    expect(explained.explained).toBe(true);
    expect(explained.agreesNow).toBe(false);
    expect(
      explainBank({
        bookCashCents: 100,
        statementEndingCents: 100,
        bookNotOnStatementCents: 0,
        statementNotInBooksCents: 0,
        openBookCents: 0,
        openStatementCents: 0,
      }).agreesNow,
    ).toBe(true);
  });

  it("uses one sales total for the report", () => {
    const report = buildSalesReport([
      {
        id: "1",
        number: "INV-1",
        issuedOn: "2026-11-02",
        partyName: "City",
        channel: "MUNICIPAL",
        subtotalCents: 10000,
        taxCents: 0,
        totalCents: 10000,
        feeCents: 0,
        lines: [{ productId: "p", productName: "Beads", qty: 10, amountCents: 10000, cogsCents: 4000 }],
      },
      {
        id: "2",
        number: "INV-2",
        issuedOn: "2026-11-03",
        partyName: "Amazon",
        channel: "AMAZON",
        subtotalCents: 5000,
        taxCents: 0,
        totalCents: 5000,
        feeCents: 800,
        lines: [{ productId: "p", productName: "Beads", qty: 5, amountCents: 5000, cogsCents: 2000 }],
      },
    ]);
    expect(report.subtotalCents).toBe(15000);
    expect(report.marginCents).toBe(9000);
    expect(report.marginAfterFeesCents).toBe(8200);
    expect(report.byCustomer.reduce((sum, row) => sum + row.amountCents, 0)).toBe(report.subtotalCents);
    expect(report.byProduct.reduce((sum, row) => sum + row.amountCents, 0)).toBe(report.subtotalCents);
  });

  it("puts overdue money ahead of draft quotes", () => {
    const items = buildAttention({
      booksProblems: [],
      overdueInvoices: [{ number: "INV-9", name: "Gulf", balanceCents: 100, id: "i" }],
      overdueBills: [],
      quarantineLots: [],
      ordersToShip: [],
      uninvoicedDeliveries: [],
      bankOpenCount: 0,
      buys: [],
      draftQuotes: [{ number: "QT-1", name: "City", id: "q" }],
      expiringCertificates: [],
      expiringNsf: [],
      incompleteProducts: [],
      usd: (cents) => `$${cents / 100}`,
    });
    expect(items[0].title).toMatch(/overdue/i);
    expect(items.at(-1)?.title).toMatch(/draft/i);
  });

  it("flags books that disagree", () => {
    expect(
      booksAgree({ trialDebit: 10, trialCredit: 10, arGl: 5, arSub: 5, apGl: 2, apSub: 2, inventoryGl: 7, inventoryLots: 7 }).ok,
    ).toBe(true);
    expect(
      booksAgree({ trialDebit: 10, trialCredit: 9, arGl: 5, arSub: 4, apGl: 1, apSub: 1, inventoryGl: 1, inventoryLots: 1 }).ok,
    ).toBe(false);
  });
});

describe("imports and access", () => {
  it("parses quoted csv and peachtree rows", () => {
    const parsed = parseCsv('Customer ID,Customer Name\nPT-1,"Palmetto, Water"\n,Missing name\n');
    expect(parsed.rows[0]["Customer Name"]).toBe("Palmetto, Water");
    expect(detectKind(parsed.headers)).toBe("customers");
    const preview = validateCustomers(parsed.rows, emptyKeys, false);
    expect(preview.rows[0].status).toBe("ok");
    expect(preview.rows[1].status).toBe("error");
    const again = validateCustomers(parsed.rows, {
      ...emptyKeys,
      partyCodes: ["PT-1"],
      parties: [{ code: "PT-1", nameKey: "palmetto water", isCustomer: true, isVendor: false }],
    }, false);
    expect(again.rows[0].status).toBe("ok");
    expect(again.ready).toEqual([]);
  });

  it("blocks a one-dollar item price and an unbalanced journal", () => {
    const items = validateItems(
      [
        { "Item ID": "GOOD", "Item Description": "Real item", "Sales Price": "2.40", Cost: "0.40", Kind: "finished" },
        { "Item ID": "FAKE", "Item Description": "Placeholder", "Sales Price": "1.00", Cost: "0.40", Kind: "finished" },
      ],
      emptyKeys,
    );
    expect(items.rows[0].status).not.toBe("error");
    expect(items.rows[1].status).toBe("error");
    const journal = validateJournal(
      [
        { Date: "11/02/2026", Reference: "BAD-1", "Account ID": "6200", Description: "Fee", Debit: "5.00", Credit: "" },
        { Date: "11/02/2026", Reference: "BAD-1", "Account ID": "1000", Description: "Fee", Debit: "", Credit: "4.00" },
      ],
      emptyKeys,
    );
    expect(journal.ready).toHaveLength(0);
    expect(journal.rows.every((row) => row.status === "error")).toBe(true);
  });

  it("treats lookalike names as the same product", () => {
    expect(nameKey("PolyPhos Liquid")).toBe(nameKey("polyphos-liquid"));
  });

  it("validates an Amazon file without calling Amazon", () => {
    const preview = validateAmazonOrders(
      [{ "order-id": "111", date: "2026-11-01", sku: "BEAD", quantity: "2", "item-price": "6.20", "referral-fee": "0.90", "fba-fee": "1.00" }],
      [{ sku: "BEAD", sellable: true, priceStatus: "CONFIRMED" }],
    );
    expect(preview.ready).toHaveLength(1);
    expect(preview.ready[0].itemPriceCents).toBe(620);
  });

  it("keeps warehouse away from money and lot release", () => {
    expect(can("WAREHOUSE", "ship")).toBe(true);
    expect(can("WAREHOUSE", "postMoney")).toBe(false);
    expect(can("WAREHOUSE", "releaseQc")).toBe(false);
    expect(can("PARTNER", "releaseQc")).toBe(true);
    expect(can("PARTNER", "manageUsers")).toBe(false);
    expect(can("READONLY", "sell")).toBe(false);
    expect(can("OWNER", "manageUsers")).toBe(true);
  });

  it("locks the sign-in after eight failures", () => {
    const now = Date.now();
    const failures = Array.from({ length: 8 }, () => ({ at: now - 1000, success: false }));
    expect(isLocked(failures, now)).toBe(true);
    expect(isLocked(failures.slice(0, 7), now)).toBe(false);
  });
});

describe("lot genealogy", () => {
  const lots = new Map([
    ["raw", { lotNumber: "L-RAW", productName: "Acid" }],
    ["fg", { lotNumber: "L-FG", productName: "PolyPhos" }],
    ["blend", { lotNumber: "L-BLEND", productName: "Rust preventer" }],
  ]);
  const batches = [
    {
      batchNumber: "PB-1",
      outputLotId: "fg",
      outputLotNumber: "L-FG",
      outputProduct: "PolyPhos",
      inputs: [{ lotId: "raw", lotNumber: "L-RAW", productName: "Acid", qty: 10 }],
    },
    {
      batchNumber: "PB-2",
      outputLotId: "blend",
      outputLotNumber: "L-BLEND",
      outputProduct: "Rust preventer",
      inputs: [{ lotId: "fg", lotNumber: "L-FG", productName: "PolyPhos", qty: 7 }],
    },
  ];

  it("walks backward to the raw lot and forward to the later blend", () => {
    const tree = traceBackward("blend", lots, batches);
    expect(tree.inputs[0].lotNumber).toBe("L-FG");
    expect(tree.inputs[0].inputs[0].lotNumber).toBe("L-RAW");
    expect(descendantLotIds("raw", batches).sort()).toEqual(["blend", "fg", "raw"]);
  });
});
