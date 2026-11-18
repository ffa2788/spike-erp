import bcrypt from "bcryptjs";
import { CODES } from "./chart";
import { dateFromParts } from "./dates";
import { DEMO_PASSWORD, DEMO_USERS } from "./demo-auth";
import { prisma } from "./db";
import { NSF_LISTED_AS_OF, NSF_LISTING_SOURCE, NSF_PUBLIC_LISTING } from "./nsf-listings";
import { addFormulaVersion, replaceSpecs, saveParty, saveProduct } from "./services/masters";
import { generateDocument } from "./services/documents";
import {
  ensureFoundation,
  importBankStatement,
  postManualJournal,
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
      "ImportBatch", "EmailLog", "StockAlert", "AlertRecipient", "DemandForecast",
      "ScheduleReleaseLine", "ScheduleRelease", "FbaBalance", "AmazonSettlementLine", "AmazonOrderItem", "AmazonSkuMap", "PayStub", "PayRun", "Employee", "PayrollTaxTable", "FixedAsset", "SafetyDocument", "PackRun", "PackBomLine", "PackagedSku", "NsfListing",
      "AuditLog", "LoginAttempt", "CompanyProfile", "User",
      "HelpRequest", "OperatingManual"
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
      entityType: "S_CORP",
      address: "100 Example Way",
      city: "Clearwater",
      state: "FL",
      zip: "33755",
      phone: "(727) 555-0198",
      nsfNote: "Example NSF/ANSI 60 drinking-water treatment listing. Not a real certificate.",
      showExampleBanner: true,
      trevorEmail: "trevor@sper.example",
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
    notes: "Example raw-material supplier. W-9 is on file. Paid for goods, so no 1099.",
    active: true,
    w9OnFile: true,
    w9ReceivedOn: day("2024-02-01"),
    infoReturn: "NONE",
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
    notes: "Example repair-and-supply vendor. W-9 is not on file.",
    active: true,
    w9OnFile: false,
    infoReturn: "NEC",
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
  const poly = await product({ ...base, sku: "POLY-LIQ", name: "SPER PolyPhos liquid", kind: "FINISHED", form: "LIQUID", specificGravity: 1.2, unit: "lb", standardCost: 0, listPrice: 2.4, sellable: true, pack: "" });
  const beads = await product({ ...base, sku: "POLY-BEAD", name: "SPER PolyPhos beads", kind: "FINISHED", form: "POWDER", unit: "lb", standardCost: 0, listPrice: 3.1, sellable: true, nsfFormulaVersion: 1, pack: "" });
  const preventer = await product({ ...base, sku: "RUST-PREV", name: "SPER Rust Preventer", kind: "FINISHED", form: "LIQUID", specificGravity: 1.15, unit: "lb", standardCost: 0, listPrice: 4.25, sellable: true, pack: "" });
  const remover = await product({ ...base, sku: "RUST-REM", name: "SPER Rust Remover", kind: "FINISHED", form: "LIQUID", specificGravity: 1.1, unit: "lb", standardCost: 0, listPrice: 3.6, sellable: true, pack: "" });
  const lawn = await product({ ...base, sku: "LAWN", name: "SPER Lawn Booster", kind: "FINISHED", form: "POWDER", unit: "lb", standardCost: 0, listPrice: 2.85, sellable: true, pack: "", category: "Lawn" });

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

  const packItem = async (sku: string, name: string, cost: number) =>
    product({
      ...base,
      sku,
      name,
      kind: "PACKAGING",
      unit: "each",
      standardCost: cost,
      category: "Packaging",
      notes: "Example packaging material. Not a real vendor price.",
      shelfLifeDays: null,
      ghsSignal: "",
      ghsPictograms: "",
      hazardStatements: "",
      precautionary: "",
    });
  const jug = await packItem("PKG-JUG-1", "Example 1 gal jug", 0.85);
  const cap = await packItem("PKG-CAP", "Example jug cap", 0.12);
  const label = await packItem("PKG-LABEL", "Example product label", 0.08);
  const carton = await packItem("PKG-CARTON-4", "Example 4x1 gal carton", 0.8);
  const divider = await packItem("PKG-DIVIDER", "Example carton divider", 0.2);
  const tape = await packItem("PKG-TAPE", "Example packing tape", 0.15);
  const pallet = await packItem("PKG-PALLET", "Example pallet", 12);
  const wrap = await packItem("PKG-WRAP", "Example stretch wrap", 3);
  const corner = await packItem("PKG-CORNER", "Example corner board", 0.35);
  const bag50 = await packItem("PKG-BAG-50", "Example 50 lb bag", 0.42);
  must(
    await postOpening(actor, {
      date: day("2026-10-01"),
      cashCents: 0,
      isExample: example,
      lots: [jug, cap, label, carton, divider, tape, pallet, wrap, corner, bag50].map((id, index) => ({
        productId: id,
        qty: index >= 6 ? 40 : 500,
        unitCost: [0.85, 0.12, 0.08, 0.8, 0.2, 0.15, 12, 3, 0.35, 0.42][index],
        lotNumber: `EX-PKG-${index + 1}`,
        expiresOn: null,
        formulaVersion: null,
        nsfEligible: false,
        notes: "Example packaging stock",
      })),
    }),
    "packaging stock",
  );
  const oneGal = await product({ ...base, sku: "POLY-LIQ-1G", name: "SPER PolyPhos liquid, 1 gal", kind: "FINISHED", form: "LIQUID", specificGravity: 1.2, unit: "each", standardCost: 0, listPrice: 28, sellable: true, trackInventory: true, notes: "Example packaged SKU. The liquid itself is not on the NSF listing." });
  const beadBag = await product({ ...base, sku: "POLY-BEAD-50", name: "SPER PolyPhos beads, 50 lb bag", kind: "FINISHED", form: "POWDER", unit: "each", standardCost: 0, listPrice: 160, sellable: true, nsfFormulaVersion: 1 });
  const rustGal = await product({ ...base, sku: "RUST-1G", name: "SPER Rust Preventer, 1 gal", kind: "FINISHED", form: "LIQUID", specificGravity: 1.15, unit: "each", standardCost: 0, listPrice: 48, sellable: true, notes: "Example packaged SKU. Not on the NSF listing." });
  const liquidBom = [
    { materialId: jug, basis: "UNIT" as const, qty: 1 },
    { materialId: cap, basis: "UNIT" as const, qty: 1 },
    { materialId: label, basis: "UNIT" as const, qty: 2 },
    { materialId: carton, basis: "CASE" as const, qty: 1 },
    { materialId: divider, basis: "CASE" as const, qty: 1 },
    { materialId: tape, basis: "CASE" as const, qty: 1 },
    { materialId: pallet, basis: "PALLET" as const, qty: 1 },
    { materialId: wrap, basis: "PALLET" as const, qty: 1 },
    { materialId: corner, basis: "PALLET" as const, qty: 4 },
  ];
  await prisma.packagedSku.create({
    data: { productId: poly, outputProductId: oneGal, packageCode: "LIQ-1", unitsPerCase: 4, casesPerPallet: 36, laborPerUnit: 0.4, isExample: true, lines: { create: liquidBom } },
  });
  await prisma.packagedSku.create({
    data: {
      productId: beads,
      outputProductId: beadBag,
      packageCode: "PWD-50LB",
      unitsPerCase: 1,
      casesPerPallet: 40,
      laborPerUnit: 0.25,
      isExample: true,
      lines: { create: [
        { materialId: bag50, basis: "UNIT", qty: 1 },
        { materialId: label, basis: "UNIT", qty: 1 },
        { materialId: tape, basis: "PALLET", qty: 2 },
        { materialId: pallet, basis: "PALLET", qty: 1 },
        { materialId: wrap, basis: "PALLET", qty: 1 },
        { materialId: corner, basis: "PALLET", qty: 4 },
      ] },
    },
  });
  await prisma.packagedSku.create({
    data: { productId: preventer, outputProductId: rustGal, packageCode: "LIQ-1", unitsPerCase: 4, casesPerPallet: 36, laborPerUnit: 0.4, isExample: true, lines: { create: liquidBom } },
  });
  for (const row of NSF_PUBLIC_LISTING) {
    await prisma.nsfListing.create({
      data: { ...row, sourceUrl: NSF_LISTING_SOURCE, listedAsOf: day(NSF_LISTED_AS_OF) },
    });
  }
  const beadListing = await prisma.nsfListing.findUniqueOrThrow({ where: { tradeName: "PolyPhos Beads" } });
  await prisma.product.updateMany({
    where: { sku: { in: ["POLY-BEAD", "POLY-BEAD-50"] } },
    data: {
      nsfListingId: beadListing.id,
      nsfCertified: true,
      nsfBody: "NSF",
      nsfUses: beadListing.function,
      nsfClaim: "Listed as PolyPhos Beads. Maximum use 13 mg/L on the NSF public listing.",
    },
  });
  must(await generateDocument(actor, beads, "TDS"), "beads tds");
  must(await generateDocument(actor, beads, "SDS"), "beads sds");
  must(await generateDocument(actor, preventer, "TDS"), "rust tds");
  must(await generateDocument(actor, preventer, "SDS"), "rust sds");

  must(
    await saveQuote(actor, {
      partyId: city,
      issuedOn: day("2026-11-14"),
      validUntil: day("2026-12-14"),
      notes: "Example quote ready to accept. 2/10 Net 30.",
      isExample: example,
      terms: {
        incoterm: "DAP",
        namedPlace: "Clearwater plant",
        creditTerm: "NET_30",
        earlyPayBps: 200,
        earlyPayDays: 10,
        freightCents: 7500,
      },
      lines: [{ productId: poly, qty: 200, specialPrice: null }],
    }),
    "quote",
  );
  await prisma.party.update({ where: { id: gulf }, data: { priceLevel: "DISTRIBUTOR" } });
  await prisma.alertRecipient.create({ data: { email: "marlon@novachem.hn", isExample: true } });
  const gallon = await prisma.product.findUnique({ where: { sku: "POLY-LIQ-1G" } });
  if (gallon) {
    await prisma.fbaBalance.create({ data: { productId: gallon.id, fulfillable: 6, inbound: 4, source: "MANUAL" } });
  }
  await prisma.product.update({ where: { id: soda }, data: { safetyQty: 500, moq: 1000, orderMultiple: 500 } });
  await prisma.priceBreak.createMany({
    data: [
      { productId: poly, priceLevel: "DISTRIBUTOR", minQty: 0, unitPriceCents: 210 },
      { productId: poly, priceLevel: "DISTRIBUTOR", minQty: 100, unitPriceCents: 195 },
    ],
  });

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

  must(
    await postManualJournal(actor, {
      date: day("2026-10-15"),
      memo: "Example tote filler the owners put into the company. Not a real purchase.",
      lines: [
        { accountCode: CODES.equipment, debitCents: 850_000, creditCents: 0, memo: "Example tote filler" },
        { accountCode: CODES.equity, debitCents: 0, creditCents: 850_000, memo: "Example equipment contributed" },
      ],
    }),
    "equipment",
  );
  await prisma.product.updateMany({ where: { sku: { in: ["RUST-PREV", "POLY-LIQ", "POLY-BEAD", "RUST-REM", "LAWN", "RUST-1G", "POLY-LIQ-1G", "POLY-BEAD-50"] } }, data: { path: "MANUFACTURED" } });
  await prisma.employee.createMany({
    data: [
      { name: "FFA", payType: "SALARY", rateCents: 400000, federalWithholdingBps: 1000, isExample: true },
      { name: "Chris", payType: "SALARY", rateCents: 300000, federalWithholdingBps: 1000, isExample: true },
      { name: "Trevor", payType: "HOURLY", rateCents: 2500, federalWithholdingBps: 800, isExample: true },
    ],
  });
  await prisma.payrollTaxTable.upsert({ where: { id: "current" }, update: {}, create: {} });
  await prisma.fixedAsset.create({
    data: {
      description: "Example tote filler",
      placedInService: day("2026-10-15"),
      costCents: 850_000,
      section179Candidate: true,
      notes: "Example equipment. Not a real purchase.",
      isExample: true,
    },
  });
}
