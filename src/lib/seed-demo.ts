import bcrypt from "bcryptjs";
import { dateFromParts } from "./dates";
import { DEMO_PASSWORD, DEMO_USERS } from "./demo-auth";
import { prisma } from "./db";
import { addFormulaVersion, replaceSpecs, saveParty, saveProduct } from "./services/masters";
import {
  ensureFoundation,
  importBankStatement,
  postOpening,
  recordOpeningStatement,
} from "./services/money";
import {
  billReceipt,
  payBill,
  receivePurchaseOrder,
  savePurchaseOrder,
} from "./services/purchasing";
import { createBatch, finishBatch, releaseLot, startBatch } from "./services/production";
import { createDirectOrder, invoiceDelivery, payInvoice, saveQuote, shipOrder } from "./services/sales";
import type { Actor } from "./services/shared";
import type { Result } from "./result";

function must<T>(result: Result<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  return result.value;
}

const day = (iso: string) => {
  const [year, month, date] = iso.split("-").map(Number);
  return dateFromParts(year, month, date);
};

const example = true;

export async function wipeDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PaymentApplication", "CustomerPayment", "InvoiceLine", "Invoice",
      "DeliveryLine", "Delivery", "SalesOrderLine", "SalesOrder", "QuoteLine", "Quote",
      "VendorPayment", "VendorBillLine", "VendorBill", "ReceiptLine", "Receipt",
      "PurchaseOrderLine", "PurchaseOrder", "BatchConsumption", "ProductionBatch",
      "QcResult", "Movement", "Lot", "FormulaLine", "Formula", "QualitySpec",
      "JournalLine", "JournalEntry", "StatementLine", "StatementImport", "BankAccount",
      "Account", "Product", "Party", "TaxRate", "Location", "NumberSequence",
      "ImportBatch", "AuditLog", "LoginAttempt", "CompanyProfile", "User"
    RESTART IDENTITY CASCADE
  `);
}

export async function seedDemo() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("spike")) throw new Error("Refusing to seed a database whose name does not include spike.");
  if (process.env.ALLOW_SEED !== "yes") throw new Error("Set ALLOW_SEED=yes. Seeding wipes the database.");
  await wipeDatabase();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const user of DEMO_USERS) {
    await prisma.user.create({
      data: { ...user, passwordHash, totpEnabled: true },
    });
  }
  const ownerRow = await prisma.user.findUniqueOrThrow({ where: { email: "frank@sper.example" } });
  const actor: Actor = { id: ownerRow.id, name: ownerRow.name, role: "OWNER" };

  must(await ensureFoundation(actor), "foundation");
  await prisma.companyProfile.create({
    data: {
      legalName: "SPER Chemical",
      address: "100 Example Way",
      city: "Clearwater",
      state: "FL",
      zip: "33755",
      phone: "(727) 555-0198",
      nsfNote: "Example NSF/ANSI 60 drinking-water treatment listing. Not a real certificate.",
      showExampleBanner: true,
    },
  });
  await prisma.taxRate.createMany({
    data: [
      { state: "FL", locality: "", name: "Florida state sales tax", rateBps: 600, isExample: true },
      { state: "FL", locality: "Pinellas", name: "Pinellas County surtax", rateBps: 100, isExample: true },
    ],
  });

  const customer = async (input: Parameters<typeof saveParty>[1]) =>
    must(await saveParty(actor, { ...input, isExample: example }), input.code).id;
  const city = await customer({
    code: "CITY-CW",
    name: "City of Clearwater Water Department",
    isCustomer: true,
    isVendor: false,
    channel: "MUNICIPAL",
    contactName: "Example buyer",
    email: "buyer@clearwater.example",
    phone: "(727) 555-0101",
    billStreet: "100 Example Way",
    billCity: "Clearwater",
    billState: "FL",
    billZip: "33755",
    shipStreet: "100 Example Way",
    shipCity: "Clearwater",
    shipState: "FL",
    shipZip: "33755",
    taxLocality: "Pinellas",
    paymentTermsDays: 30,
    creditLimitCents: 5000000,
    taxExempt: true,
    exemptionNumber: "EX-EXAMPLE-1001",
    exemptionState: "FL",
    exemptionExpires: day("2027-12-31"),
    leadTimeDays: null,
    notes: "Example municipal customer. Tax exempt.",
    active: true,
  });
  const gulf = await customer({
    code: "GULF-DIST",
    name: "Gulf Coast Distributors",
    isCustomer: true,
    isVendor: false,
    channel: "DISTRIBUTOR",
    contactName: "Example purchaser",
    email: "ap@gulfcoast.example",
    phone: "(727) 555-0144",
    billStreet: "20 Example Dock",
    billCity: "Clearwater",
    billState: "FL",
    billZip: "33755",
    shipStreet: "20 Example Dock",
    shipCity: "Clearwater",
    shipState: "FL",
    shipZip: "33755",
    taxLocality: "Pinellas",
    paymentTermsDays: 30,
    creditLimitCents: 2000000,
    taxExempt: false,
    exemptionNumber: "",
    exemptionState: "",
    exemptionExpires: null,
    leadTimeDays: null,
    notes: "Example distributor. Taxable.",
    active: true,
  });
  await customer({
    code: "SPRINGS",
    name: "Example Springs Utility",
    isCustomer: true,
    isVendor: false,
    channel: "MUNICIPAL",
    contactName: "Example clerk",
    email: "clerk@springs.example",
    phone: "(727) 555-0177",
    billStreet: "5 Example Spring",
    billCity: "Dunedin",
    billState: "FL",
    billZip: "34698",
    shipStreet: "5 Example Spring",
    shipCity: "Dunedin",
    shipState: "FL",
    shipZip: "34698",
    taxLocality: "Pinellas",
    paymentTermsDays: 30,
    creditLimitCents: 1000000,
    taxExempt: true,
    exemptionNumber: "EX-EXAMPLE-1044",
    exemptionState: "FL",
    exemptionExpires: day("2026-12-01"),
    leadTimeDays: null,
    notes: "Example certificate that expires soon.",
    active: true,
  });
  await customer({
    code: "AMAZON",
    name: "Amazon channel",
    isCustomer: true,
    isVendor: false,
    channel: "AMAZON",
    contactName: "",
    email: "",
    phone: "",
    billStreet: "",
    billCity: "",
    billState: "WA",
    billZip: "",
    shipStreet: "",
    shipCity: "",
    shipState: "WA",
    shipZip: "",
    taxLocality: "",
    paymentTermsDays: 14,
    creditLimitCents: 0,
    taxExempt: false,
    exemptionNumber: "",
    exemptionState: "",
    exemptionExpires: null,
    leadTimeDays: null,
    notes: "Example channel customer. Not a connection to Amazon.",
    active: true,
  });
  const phosphate = await customer({
    code: "PHOS-SUP",
    name: "Phosphate Rock Supply",
    isCustomer: false,
    isVendor: true,
    channel: "DIRECT",
    contactName: "Example seller",
    email: "orders@phosphate.example",
    phone: "(813) 555-0160",
    billStreet: "400 Example Mine Road",
    billCity: "Tampa",
    billState: "FL",
    billZip: "33602",
    shipStreet: "",
    shipCity: "",
    shipState: "",
    shipZip: "",
    taxLocality: "",
    paymentTermsDays: 30,
    creditLimitCents: 0,
    taxExempt: false,
    exemptionNumber: "",
    exemptionState: "",
    exemptionExpires: null,
    leadTimeDays: 14,
    notes: "Example raw-material supplier.",
    active: true,
  });
  const caustic = await customer({
    code: "CAUSTIC",
    name: "Gulf Caustic",
    isCustomer: false,
    isVendor: true,
    channel: "DIRECT",
    contactName: "Example dispatcher",
    email: "sales@gulfcaustic.example",
    phone: "(813) 555-0118",
    billStreet: "8 Example Tank Farm",
    billCity: "Tampa",
    billState: "FL",
    billZip: "33605",
    shipStreet: "",
    shipCity: "",
    shipState: "",
    shipZip: "",
    taxLocality: "",
    paymentTermsDays: 30,
    creditLimitCents: 0,
    taxExempt: false,
    exemptionNumber: "",
    exemptionState: "",
    exemptionExpires: null,
    leadTimeDays: 10,
    notes: "Example caustic supplier.",
    active: true,
  });

  const product = async (input: Parameters<typeof saveProduct>[1]) =>
    must(await saveProduct(actor, { ...input, isExample: example }), input.sku).id;
  const base = {
    category: "Water treatment",
    allowOneDollar: false,
    taxable: true,
    trackInventory: true,
    shelfLifeDays: 720,
    pack: "Drum",
    casNumber: "",
    leadTimeDays: 14,
    nsfCertified: false,
    nsfCertNumber: "",
    nsfBody: "",
    nsfUses: "",
    nsfIssuedOn: null as Date | null,
    nsfExpiresOn: null as Date | null,
    nsfFormulaVersion: null as number | null,
    nsfClaim: "",
    ghsSignal: "Warning",
    ghsPictograms: "exclamation",
    hazardStatements: "Example hazard text: may irritate eyes and skin.",
    precautionary: "Example precaution: wear eye protection and gloves.",
    active: true,
    sellable: false,
    listPrice: null as number | null,
    minQty: 0,
    preferredVendorId: null as string | null,
    notes: "Example data. Not a real price or hazard classification.",
  };
  const acid = await product({ ...base, sku: "PA-75", name: "Phosphoric acid 75%", kind: "RAW", unit: "lb", standardCost: 0.48, minQty: 1000, preferredVendorId: phosphate, category: "Acid", sellable: false });
  const causticId = await product({ ...base, sku: "NAOH-50", name: "Sodium hydroxide 50%", kind: "RAW", unit: "lb", standardCost: 0.31, minQty: 400, preferredVendorId: caustic, ghsSignal: "Danger", ghsPictograms: "corrosion", hazardStatements: "Example hazard text: causes severe skin burns.", category: "Alkali" });
  const shmp = await product({ ...base, sku: "SHMP", name: "Sodium hexametaphosphate", kind: "RAW", unit: "lb", standardCost: 0.92, minQty: 1000, preferredVendorId: phosphate, category: "Phosphate" });
  const soda = await product({ ...base, sku: "SODA", name: "Soda ash dense", kind: "RAW", unit: "lb", standardCost: 0.22, minQty: 5000, preferredVendorId: phosphate, category: "Alkali" });
  const zinc = await product({ ...base, sku: "ZINC", name: "Zinc chloride solution", kind: "RAW", unit: "lb", standardCost: 1.15, minQty: 200, preferredVendorId: caustic, category: "Metal salt" });
  await product({
    ...base,
    sku: "WATER",
    name: "Deionized water",
    kind: "UTILITY",
    unit: "lb",
    standardCost: 0.02,
    trackInventory: false,
    shelfLifeDays: null,
    pack: "",
    ghsSignal: "",
    ghsPictograms: "",
    hazardStatements: "",
    precautionary: "",
    category: "Utility",
    notes: "Utility. Consumption is recorded, but there is no on-hand balance.",
  });
  const nsf = {
    nsfCertified: true,
    nsfCertNumber: "EX-NSF-60-100",
    nsfBody: "Example certifying body",
    nsfUses: "Example drinking-water treatment use",
    nsfIssuedOn: day("2024-01-15"),
    nsfExpiresOn: day("2027-12-31"),
    nsfFormulaVersion: 1,
    nsfClaim: "Example only: produced under an NSF/ANSI 60 listing for drinking-water treatment. Not a real listing.",
    sellable: true,
    category: "Finished phosphate",
  };
  const poly = await product({ ...base, ...nsf, sku: "POLY-LIQ", name: "SPER PolyPhos liquid", kind: "FINISHED", unit: "lb", standardCost: 0, listPrice: 2.4, pack: "Drum" });
  const beads = await product({ ...base, ...nsf, sku: "POLY-BEAD", name: "SPER PolyPhos beads", kind: "FINISHED", unit: "lb", standardCost: 0, listPrice: 3.1, pack: "Bag", nsfExpiresOn: day("2026-12-01") });
  const preventer = await product({ ...base, ...nsf, sku: "RUST-PREV", name: "SPER Rust Preventer", kind: "FINISHED", unit: "lb", standardCost: 0, listPrice: 4.25, pack: "Tote" });
  const remover = await product({ ...base, ...nsf, sku: "RUST-REM", name: "SPER Rust Remover", kind: "FINISHED", unit: "lb", standardCost: 0, listPrice: 3.6, nsfCertified: false, nsfCertNumber: "", nsfFormulaVersion: null, nsfClaim: "", nsfExpiresOn: null, nsfIssuedOn: null });
  const lawn = await product({ ...base, sku: "LAWN", name: "SPER Lawn Booster", kind: "FINISHED", unit: "lb", standardCost: 0, listPrice: 2.85, sellable: true, pack: "Bag", category: "Lawn" });

  const formula = async (productId: string, lines: { ingredientId: string; percent: number }[]) =>
    must(
      await addFormulaVersion(actor, { productId, batchQty: 1000, notes: "Example production recipe.", makeDefault: true, lines }),
      "formula",
    );
  await formula(poly, [
    { ingredientId: shmp, percent: 35 },
    { ingredientId: acid, percent: 15 },
    { ingredientId: (await prisma.product.findUniqueOrThrow({ where: { sku: "WATER" } })).id, percent: 50 },
  ]);
  await formula(beads, [
    { ingredientId: shmp, percent: 80 },
    { ingredientId: soda, percent: 15 },
    { ingredientId: (await prisma.product.findUniqueOrThrow({ where: { sku: "WATER" } })).id, percent: 5 },
  ]);
  await formula(preventer, [
    { ingredientId: poly, percent: 70 },
    { ingredientId: zinc, percent: 10 },
    { ingredientId: (await prisma.product.findUniqueOrThrow({ where: { sku: "WATER" } })).id, percent: 20 },
  ]);
  await formula(remover, [
    { ingredientId: acid, percent: 40 },
    { ingredientId: causticId, percent: 5 },
    { ingredientId: (await prisma.product.findUniqueOrThrow({ where: { sku: "WATER" } })).id, percent: 55 },
  ]);
  await formula(lawn, [
    { ingredientId: shmp, percent: 25 },
    { ingredientId: soda, percent: 20 },
    { ingredientId: (await prisma.product.findUniqueOrThrow({ where: { sku: "WATER" } })).id, percent: 55 },
  ]);

  const spec = async (productId: string) =>
    must(
      await replaceSpecs(actor, productId, [
        { parameter: "pH", unit: "pH", min: 6, max: 8, target: 7 },
        { parameter: "Specific gravity", unit: "SG", min: 1.1, max: 1.4, target: 1.25 },
      ]),
      "specs",
    );
  await spec(poly);
  await spec(beads);
  await spec(preventer);

  const opening = must(
    await postOpening(actor, {
      date: day("2026-10-01"),
      cashCents: 7_500_000,
      isExample: example,
      lots: [
        { productId: acid, qty: 8000, unitCost: 0.48, lotNumber: "EX-PA-1", expiresOn: day("2028-10-01"), formulaVersion: null, nsfEligible: false, notes: "Example opening stock" },
        { productId: causticId, qty: 2000, unitCost: 0.31, lotNumber: "EX-NAOH-1", expiresOn: day("2028-10-01"), formulaVersion: null, nsfEligible: false, notes: "Example opening stock" },
        { productId: shmp, qty: 6000, unitCost: 0.92, lotNumber: "EX-SHMP-1", expiresOn: day("2028-10-01"), formulaVersion: null, nsfEligible: false, notes: "Example opening stock" },
        { productId: soda, qty: 3000, unitCost: 0.22, lotNumber: "EX-SODA-1", expiresOn: day("2028-10-01"), formulaVersion: null, nsfEligible: false, notes: "Example opening stock" },
        { productId: zinc, qty: 800, unitCost: 1.15, lotNumber: "EX-ZINC-1", expiresOn: day("2028-10-01"), formulaVersion: null, nsfEligible: false, notes: "Example opening stock" },
        { productId: beads, qty: 1500, unitCost: 0.77, lotNumber: "EX-BEAD-1", expiresOn: day("2028-04-01"), formulaVersion: 1, nsfEligible: true, notes: "Example opening finished goods" },
        { productId: lawn, qty: 500, unitCost: 0.285, lotNumber: "EX-LAWN-1", expiresOn: day("2028-04-01"), formulaVersion: 1, nsfEligible: false, notes: "Example opening finished goods" },
      ],
    }),
    "opening",
  );
  must(
    await recordOpeningStatement(actor, { journalId: opening.journalId, amountCents: 7_500_000, date: day("2026-10-01") }),
    "opening statement",
  );

  const polyBatch = must(await createBatch(actor, { productId: poly, plannedQty: 1000, notes: "Example batch.", isExample: example }), "poly batch");
  must(await startBatch(actor, polyBatch.id, day("2026-11-01")), "start poly");
  const polyLot = must(await finishBatch(actor, { batchId: polyBatch.id, actualQty: 1000, closedOn: day("2026-11-01") }), "finish poly");
  must(
    await releaseLot(actor, {
      lotId: polyLot.lotId,
      releasedOn: day("2026-11-01"),
      confirmation: "",
      results: [
        { parameter: "pH", value: 7 },
        { parameter: "Specific gravity", value: 1.25 },
      ],
    }),
    "release poly",
  );

  const sell = async (partyId: string, productId: string, qty: number, price: number, on: string, pay?: number) => {
    const order = must(
      await createDirectOrder(actor, {
        partyId,
        orderedOn: day(on),
        customerPo: "EXAMPLE",
        notes: "Example history.",
        isExample: example,
        lines: [{ productId, qty, specialPrice: price }],
      }),
      "order",
    );
    const shipped = must(
      await shipOrder(actor, { orderId: order.orderId, shipAll: true, shippedOn: day(on), carrier: "Example freight", tracking: "", notes: "" }),
      "ship",
    );
    const invoice = must(await invoiceDelivery(actor, shipped.deliveryId, day(on)), "invoice");
    if (pay) {
      must(
        await payInvoice(actor, { invoiceId: invoice.invoiceId, amountCents: pay, paidOn: day(on), method: "ACH", reference: "Example payment" }),
        "pay",
      );
    }
  };
  await sell(city, beads, 500, 3.1, "2026-11-03", 155000);
  await sell(gulf, poly, 100, 2.4, "2026-11-10");
  await sell(gulf, lawn, 50, 2.85, "2026-10-15");
  await prisma.invoice.updateMany({
    where: { issuedOn: day("2026-10-15") },
    data: { dueOn: day("2026-10-20") },
  });

  const paidPo = must(
    await savePurchaseOrder(actor, {
      partyId: phosphate,
      orderedOn: day("2026-10-20"),
      expectedOn: day("2026-11-04"),
      notes: "Example received order.",
      send: true,
      isExample: example,
      lines: [{ productId: shmp, qty: 1000, unitPrice: 0.92 }],
    }),
    "paid po",
  );
  const receipt = must(
    await receivePurchaseOrder(actor, {
      orderId: paidPo.id,
      receivedOn: day("2026-11-04"),
      notes: "",
      lines: (await prisma.purchaseOrderLine.findMany({ where: { orderId: paidPo.id } })).map((line) => ({
        orderLineId: line.id,
        qty: Number(line.qty),
        supplierLot: "SUP-EX-44",
        expiresOn: day("2028-11-04"),
      })),
    }),
    "receive",
  );
  const receivedLot = await prisma.receiptLine.findFirstOrThrow({ where: { receiptId: receipt.receiptId } });
  must(await releaseLot(actor, { lotId: receivedLot.lotId, releasedOn: day("2026-11-04"), confirmation: "RELEASE", results: [] }), "release raw");
  const bill = must(
    await billReceipt(actor, {
      receiptId: receipt.receiptId,
      vendorRef: "EX-INV-920",
      billedOn: day("2026-11-04"),
      lines: [],
    }),
    "bill",
  );
  must(await payBill(actor, { billId: bill.billId, amountCents: 92000, paidOn: day("2026-11-04"), method: "Check", reference: "1402" }), "pay bill");

  must(
    await savePurchaseOrder(actor, {
      partyId: phosphate,
      orderedOn: day("2026-11-12"),
      expectedOn: day("2026-11-26"),
      notes: "Example open order, not received yet.",
      send: true,
      isExample: example,
      lines: [{ productId: acid, qty: 2000, unitPrice: 0.48 }],
    }),
    "open po",
  );

  const rust = must(await createBatch(actor, { productId: preventer, plannedQty: 1000, notes: "Example batch waiting for quality.", isExample: example }), "rust batch");
  must(await startBatch(actor, rust.id, day("2026-11-13")), "start rust");
  must(await finishBatch(actor, { batchId: rust.id, actualQty: 1000, closedOn: day("2026-11-13") }), "finish rust");

  must(
    await saveQuote(actor, {
      partyId: city,
      issuedOn: day("2026-11-14"),
      validUntil: day("2026-12-14"),
      notes: "Example quote ready to accept.",
      isExample: example,
      lines: [{ productId: poly, qty: 200, specialPrice: null }],
    }),
    "quote",
  );

  const csv = [
    "Date,Description,Amount",
    "2026-11-03,City of Clearwater payment,1550.00",
    "2026-11-04,Phosphate Rock Supply,-920.00",
    "2026-11-05,Bank service fee,-15.00",
  ].join("\n");
  must(
    await importBankStatement(actor, {
      csv,
      fileName: "example-statement.csv",
      statementDate: day("2026-11-05"),
      endingBalanceCents: 7_561_500,
    }),
    "bank import",
  );
}
