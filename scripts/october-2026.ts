import "dotenv/config";
import { prisma } from "../src/lib/db";
import { ALL_ORDERS_HEADERS } from "../src/lib/amazon-reports";
import { PAYMENT_HEADERS } from "../src/lib/amazon-payments";
import { CODES } from "../src/lib/chart";
import { ensureFoundation, importBankStatement, postManualJournal } from "../src/lib/services/money";
import { saveParty, type PartyInput } from "../src/lib/services/masters";
import { saveQuote, acceptQuote, shipOrder, invoiceDelivery, payInvoice, issueCreditMemo } from "../src/lib/services/sales";
import { savePurchaseOrder, receivePurchaseOrder, billReceipt, payBill } from "../src/lib/services/purchasing";
import { createBatch, startBatch, finishBatch, releaseLot } from "../src/lib/services/production";
import { shipToFba } from "../src/lib/services/fba-ledger";
import { importAmazonReports } from "../src/lib/services/amazon-report-import";
import { matchAmazonDeposit } from "../src/lib/services/amazon-week";
import { commitMarketplace } from "../src/lib/services/importers";
import { buildSchedule, releaseSchedule, emailSchedule } from "../src/lib/services/schedule-run";
import { createPayRun, postPayRun } from "../src/lib/services/payroll-run";
import { currentStock } from "../src/lib/read-models";
import { lotQty, valueCents } from "../src/lib/inventory";
import { numberGaps } from "../src/lib/owner-reports";
import type { Actor } from "../src/lib/services/shared";

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  return result.value;
}

const partyBlank = {
  contactName: "Example buyer",
  email: "buyer@example.test",
  phone: "(727) 555-0100",
  billStreet: "1 Example St",
  billCity: "Clearwater",
  billState: "FL",
  billZip: "33755",
  shipStreet: "1 Example St",
  shipCity: "Clearwater",
  shipState: "FL",
  shipZip: "33755",
  taxLocality: "",
  paymentTermsDays: 30,
  creditLimitCents: 0,
  taxExempt: false,
  exemptionNumber: "",
  exemptionState: "",
  exemptionExpires: null,
  leadTimeDays: null,
  active: true,
  isExample: true,
};

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", active: true } });
  const actor: Actor = { id: owner.id, name: owner.name, role: "OWNER" };
  must(await ensureFoundation(actor), "foundation");
  const ordersImported = await prisma.amazonOrderItem.findFirst({ where: { amazonOrderId: "111-2026OCT-0001" } });
  const depositPosted = await prisma.journalEntry.findFirst({ where: { source: "AMAZON_TRANSFER", sourceId: "OCT2026SETTLE" } });
  if (!ordersImported) await amazonMonth(actor);
  else if (!depositPosted) await amazonPaymentsOnly(actor);
  else console.log("October Amazon orders and the deposit are already posted.");
  if ((await prisma.quote.count({ where: { notes: "OCT2026 direct" } })) < 17) {
    await directMonth(actor);
  } else console.log("October direct and export quotes are already saved.");
  if (!(await prisma.journalEntry.findFirst({ where: { source: "CREDIT_MEMO", memo: { contains: "Example price credit" } } }))) {
    const other = await prisma.invoice.findFirst({ where: { number: "E-1", balanceCents: { gt: 300 } } });
    if (other) {
      must(await issueCreditMemo(actor, {
        invoiceId: other.id,
        amountCents: 300,
        issuedOn: new Date("2026-10-23T12:00:00Z"),
        reason: "Example price credit. Approved by FFA.",
      }), "credit memo");
    }
  }
  await expensesAndPayroll(actor);
  await audit();
}

async function amazonPaymentsOnly(actor: Actor) {
  const payments = [PAYMENT_HEADERS.join(",")];
  let net = 0;
  for (let index = 1; index <= 210; index += 1) {
    const fba = index <= 150;
    const day = String(((index - 1) % 28) + 1).padStart(2, "0");
    const id = `111-2026OCT-${String(index).padStart(4, "0")}`;
    const referral = 8;
    const fbaFee = fba ? 5 : 0;
    const total = 55 - referral - fbaFee;
    net += Math.round(total * 100);
    payments.push(paymentRow({ day: `2026-10-${day}`, orderId: id, type: "Order", sku: "SC-RP1-1.0-1", sales: "55.00", selling: `-${referral.toFixed(2)}`, fba: fbaFee ? `-${fbaFee.toFixed(2)}` : "0.00", total: total.toFixed(2) }));
  }
  payments.push(paymentRow({ day: "2026-10-20", orderId: "111-2026OCT-0001", type: "Refund", sku: "SC-RP1-1.0-1", sales: "-42.00", selling: "8.00", fba: "5.00", total: "-42.00" }));
  net -= 4200;
  payments.push(paymentRow({ day: "2026-10-31", orderId: "", type: "Transfer", sku: "", sales: "0.00", selling: "0.00", fba: "0.00", total: (-net / 100).toFixed(2) }));
  must(await importAmazonReports(actor, { payments: payments.join("\n") }), "amazon payments");
  const entry = await prisma.journalEntry.findFirstOrThrow({ where: { source: "AMAZON_TRANSFER", sourceId: "OCT2026SETTLE" }, include: { lines: { include: { account: true } } } });
  const cash = entry.lines.find((line) => line.account.code === "1000");
  const cents = (cash?.debitCents ?? 0) - (cash?.creditCents ?? 0);
  must(await importBankStatement(actor, {
    csv: `Date,Description,Amount\n2026-10-31,AMAZON PAYMENTS OCT2026SETTLE,${(cents / 100).toFixed(2)}\n`,
    fileName: "truist-october-example.csv",
    statementDate: new Date("2026-10-31T12:00:00Z"),
    endingBalanceCents: cents,
  }), "bank");
  const bank = await prisma.statementLine.findFirstOrThrow({ where: { description: { contains: "OCT2026SETTLE" }, reconciled: false } });
  must(await matchAmazonDeposit(actor, { statementLineId: bank.id, settlementId: "OCT2026SETTLE" }), "match deposit");
  console.log("deposit cents", cents);
}

async function amazonMonth(actor: Actor) {
  const product = await prisma.product.findUniqueOrThrow({ where: { sku: "RUST-1G" } });
  await prisma.amazonSkuMap.upsert({
    where: { amazonSku: "SC-RP1-1.0-1" },
    update: { productId: product.id, asin: "B0EXAMPLE01" },
    create: { amazonSku: "SC-RP1-1.0-1", asin: "B0EXAMPLE01", productId: product.id },
  });
  const stock = await currentStock();
  const lots = stock.filter((lot) => lot.productId === product.id && lot.qcStatus === "APPROVED" && lot.locations.some((place) => place.locationCode === "MAIN" && place.qty > 0));
  let left = 150;
  const lines: { lotId: string; qty: number }[] = [];
  for (const lot of lots) {
    if (left <= 0) break;
    const qty = Math.min(left, lot.locations.find((place) => place.locationCode === "MAIN")?.qty ?? 0);
    if (qty > 0) {
      lines.push({ lotId: lot.lotId, qty });
      left -= qty;
    }
  }
  if (left > 0) throw new Error(`Need 150 jugs in Clearwater to ship to FBA, short ${left}.`);
  must(await shipToFba(actor, { shipmentId: "FBA-OCT-2026", shippedOn: new Date("2026-10-02T12:00:00Z"), freightCents: 15000, lines }), "fba ship");
  const header = ALL_ORDERS_HEADERS.join("\t");
  const rows = [header];
  for (let index = 1; index <= 210; index += 1) {
    const fba = index <= 150;
    const day = String(((index - 1) % 28) + 1).padStart(2, "0");
    const id = `111-2026OCT-${String(index).padStart(4, "0")}`;
    const cells = ALL_ORDERS_HEADERS.map(() => "");
    const set = (name: string, value: string) => { cells[ALL_ORDERS_HEADERS.indexOf(name as typeof ALL_ORDERS_HEADERS[number])] = value; };
    set("amazon-order-id", id);
    set("purchase-date", `2026-10-${day}T15:00:00+00:00`);
    set("last-updated-date", `2026-10-${day}T16:00:00+00:00`);
    set("order-status", "Shipped");
    set("fulfillment-channel", fba ? "Amazon" : "Merchant");
    set("sales-channel", "Amazon.com");
    set("product-name", "Example Rust Preventer 1 gal");
    set("sku", "SC-RP1-1.0-1");
    set("asin", "B0EXAMPLE01");
    set("item-status", "Shipped");
    set("quantity", "1");
    set("currency", "USD");
    set("item-price", "55.00");
    set("ship-city", "Tampa");
    set("ship-state", "FL");
    set("ship-postal-code", "33602");
    set("ship-country", "US");
    set("order-item-id", String(800000 + index));
    rows.push(cells.join("\t"));
  }
  const imported = must(await importAmazonReports(actor, { orders: rows.join("\n") }), "amazon orders");
  console.log("amazon invoices", imported.invoicesCreated);
  const payments = [PAYMENT_HEADERS.join(",")];
  let net = 0;
  for (let index = 1; index <= 210; index += 1) {
    const fba = index <= 150;
    const day = String(((index - 1) % 28) + 1).padStart(2, "0");
    const id = `111-2026OCT-${String(index).padStart(4, "0")}`;
    const referral = 8;
    const fbaFee = fba ? 5 : 0;
    const total = 55 - referral - fbaFee;
    net += Math.round(total * 100);
    payments.push(paymentRow({ day: `2026-10-${day}`, orderId: id, type: "Order", sku: "SC-RP1-1.0-1", sales: "55.00", selling: `-${referral.toFixed(2)}`, fba: fbaFee ? `-${fbaFee.toFixed(2)}` : "0.00", total: total.toFixed(2) }));
  }
  payments.push(paymentRow({ day: "2026-10-20", orderId: "111-2026OCT-0001", type: "Refund", sku: "SC-RP1-1.0-1", sales: "-42.00", selling: "8.00", fba: "5.00", total: "-42.00" }));
  net -= 4200;
  payments.push(paymentRow({ day: "2026-10-31", orderId: "", type: "Transfer", sku: "", sales: "0.00", selling: "0.00", fba: "0.00", total: (-net / 100).toFixed(2) }));
  must(await importAmazonReports(actor, { payments: payments.join("\n") }), "amazon payments");
  const entry = await prisma.journalEntry.findFirstOrThrow({ where: { source: "AMAZON_TRANSFER", sourceId: "OCT2026SETTLE" }, include: { lines: { include: { account: true } } } });
  const cash = entry.lines.find((line) => line.account.code === "1000");
  const cents = (cash?.debitCents ?? 0) - (cash?.creditCents ?? 0);
  must(await importBankStatement(actor, {
    csv: `Date,Description,Amount\n2026-10-31,AMAZON PAYMENTS OCT2026SETTLE,${(cents / 100).toFixed(2)}\n`,
    fileName: "truist-october-example.csv",
    statementDate: new Date("2026-10-31T12:00:00Z"),
    endingBalanceCents: cents,
  }), "bank");
  const bank = await prisma.statementLine.findFirstOrThrow({ where: { description: { contains: "OCT2026SETTLE" }, reconciled: false } });
  must(await matchAmazonDeposit(actor, { statementLineId: bank.id, settlementId: "OCT2026SETTLE" }), "match deposit");
  console.log("deposit cents", cents);
}

function paymentRow(input: { day: string; orderId: string; type: string; sku: string; sales: string; selling: string; fba: string; total: string }) {
  const cells = PAYMENT_HEADERS.map(() => "");
  const set = (name: string, value: string) => { cells[PAYMENT_HEADERS.indexOf(name as typeof PAYMENT_HEADERS[number])] = value; };
  set("date/time", input.day);
  set("settlement id", "OCT2026SETTLE");
  set("type", input.type);
  set("order id", input.orderId);
  set("sku", input.sku);
  set("description", input.type);
  set("quantity", input.type === "Order" ? "1" : "0");
  set("product sales", input.sales);
  set("selling fees", input.selling);
  set("fba fees", input.fba);
  set("total", input.total);
  return cells.join(",");
}

async function directMonth(actor: Actor) {
  const customers = await prisma.party.findMany({ where: { isCustomer: true, channel: { in: ["DIRECT", "DISTRIBUTOR", "MUNICIPAL"] }, active: true } });
  const product = await prisma.product.findFirstOrThrow({ where: { sku: "POLY-BEAD", sellable: true } });
  const terms: { creditTerm: "NET_30" | "PREPAID"; earlyPayBps: number; earlyPayDays: number }[] = [
    { creditTerm: "NET_30", earlyPayBps: 0, earlyPayDays: 0 },
    { creditTerm: "NET_30", earlyPayBps: 200, earlyPayDays: 10 },
    { creditTerm: "PREPAID", earlyPayBps: 0, earlyPayDays: 0 },
  ];
  const made: string[] = [];
  const existingQuotes = await prisma.quote.findMany({ where: { notes: "OCT2026 direct", party: { channel: { not: "EXPORT" } } }, orderBy: { issuedOn: "asc" } });
  if (existingQuotes.length >= 15) {
    for (const quote of existingQuotes.slice(0, 15)) {
      const accepted = quote.status === "ACCEPTED"
        ? await prisma.salesOrder.findFirstOrThrow({ where: { quoteId: quote.id } })
        : must(await acceptQuote(actor, quote.id), `accept ${quote.number}`);
      const orderId = "orderId" in accepted ? accepted.orderId : accepted.id;
      const delivery = await prisma.delivery.findFirst({ where: { orderId }, include: { invoice: true } });
      const shipped = delivery ?? must(await shipOrder(actor, { orderId, shipAll: true, shippedOn: quote.issuedOn, carrier: "Example truck", tracking: quote.number, notes: "OCT2026 direct" }), `ship ${quote.number}`);
      const deliveryId = "deliveryId" in shipped ? shipped.deliveryId : shipped.id;
      const invoice = await prisma.invoice.findFirst({ where: { deliveryId } });
      const invoiced = invoice ?? must(await invoiceDelivery(actor, deliveryId, quote.issuedOn), `invoice ${quote.number}`);
      made.push("invoiceId" in invoiced ? invoiced.invoiceId : invoiced.id);
    }
  } else {
  for (let index = 0; index < 15; index += 1) {
    const party = customers[index % customers.length];
    const term = terms[index % terms.length];
    const day = String((index % 27) + 1).padStart(2, "0");
    const quote = must(await saveQuote(actor, {
      partyId: party.id,
      issuedOn: new Date(`2026-10-${day}T12:00:00Z`),
      validUntil: new Date("2026-11-30T12:00:00Z"),
      notes: "OCT2026 direct",
      isExample: true,
      lines: [{ productId: product.id, qty: 10, specialPrice: null }],
      terms: { incoterm: "EXW", namedPlace: "Clearwater plant", creditTerm: term.creditTerm, earlyPayBps: term.earlyPayBps, earlyPayDays: term.earlyPayDays },
    }), `quote ${index}`);
    const order = must(await acceptQuote(actor, quote.id), `accept ${index}`);
    const shipped = must(await shipOrder(actor, { orderId: order.orderId, shipAll: true, shippedOn: new Date(`2026-10-${day}T12:00:00Z`), carrier: "Example truck", tracking: `OCT-${index}`, notes: "OCT2026 direct" }), `ship ${index}`);
    const invoice = must(await invoiceDelivery(actor, shipped.deliveryId, new Date(`2026-10-${day}T12:00:00Z`)), `invoice ${index}`);
    made.push(invoice.invoiceId);
  }
  }
  for (let index = 0; index < made.length; index += 1) {
    if (index === 0 || index === 1) continue;
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: made[index] } });
    if (invoice.balanceCents <= 0) continue;
    must(await payInvoice(actor, { invoiceId: invoice.id, amountCents: invoice.balanceCents, paidOn: new Date("2026-10-28T12:00:00Z"), method: "Check", reference: `OCT-PAY-${index}` }), `pay ${index}`);
  }
  const short = await prisma.invoice.findUniqueOrThrow({ where: { id: made[1] } });
  if (short.balanceCents > 1 && !(await prisma.customerPayment.findFirst({ where: { reference: "OCT-SHORT" } }))) {
    must(await payInvoice(actor, { invoiceId: short.id, amountCents: Math.max(1, Math.round(short.balanceCents / 2)), paidOn: new Date("2026-10-20T12:00:00Z"), method: "Check", reference: "OCT-SHORT" }), "short pay");
  }
  const exportParty = await party(actor, "EXPORT-EX", "Example Export Buyer", "EXPORT");
  for (const [term, place] of [["FOB", "Tampa port"], ["CIF", "Hamburg port"]] as const) {
    const quote = must(await saveQuote(actor, {
      partyId: exportParty,
      issuedOn: new Date("2026-10-12T12:00:00Z"),
      validUntil: new Date("2026-11-30T12:00:00Z"),
      notes: "OCT2026 direct",
      isExample: true,
      lines: [{ productId: product.id, qty: 20, specialPrice: null }],
      terms: { incoterm: term, namedPlace: place, creditTerm: "NET_30", freightCents: term === "CIF" ? 15000 : 0, insuranceCents: term === "CIF" ? 4000 : 0 },
    }), `export ${term}`);
    const order = must(await acceptQuote(actor, quote.id), `export accept ${term}`);
    const shipped = must(await shipOrder(actor, { orderId: order.orderId, shipAll: true, shippedOn: new Date("2026-10-13T12:00:00Z"), carrier: "Example ocean", tracking: `E-${term[0]}`, notes: "OCT2026 direct" }), "export ship");
    must(await invoiceDelivery(actor, shipped.deliveryId, new Date("2026-10-13T12:00:00Z")), "export invoice");
  }
  const walmart = await party(actor, "WALMART-EX", "Example Walmart", "WALMART");
  const csv = ["order-id,date,sku,quantity,item-price,referral-fee,fba-fee"];
  for (let index = 1; index <= 5; index += 1) csv.push(`W-OCT-${index},2026-10-${String(index + 2).padStart(2, "0")},POLY-BEAD,5,15.50,1.50,0`);
  must(await commitMarketplace(actor, csv.join("\n"), "WALMART"), "walmart");
  void walmart;
  const vendor = await prisma.party.findFirstOrThrow({ where: { isVendor: true, active: true } });
  const material = await prisma.product.findFirstOrThrow({ where: { sku: "PKG-BAG-50" } });
  const po = must(await savePurchaseOrder(actor, {
    partyId: vendor.id, orderedOn: new Date("2026-10-03T12:00:00Z"), expectedOn: new Date("2026-10-10T12:00:00Z"),
    notes: "OCT2026 bags", send: true, isExample: true, lines: [{ productId: material.id, qty: 20, unitPrice: 0.42 }],
  }), "po bags");
  const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true } });
  const receipt = must(await receivePurchaseOrder(actor, {
    orderId: order.id, receivedOn: new Date("2026-10-10T12:00:00Z"), notes: "OCT2026 bags",
    lines: order.lines.map((line) => ({ orderLineId: line.id, qty: Number(line.qty), supplierLot: "OCT-BAG", expiresOn: null })),
  }), "receive bags");
  const full = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.receiptId }, include: { lines: true } });
  const bill = must(await billReceipt(actor, {
    receiptId: full.id, vendorRef: "EX-OCT-100", billedOn: new Date("2026-10-11T12:00:00Z"),
    lines: full.lines.map((line) => ({ receiptLineId: line.id, unitPrice: 0.42 })),
  }), "bill");
  const openBill = await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.billId } });
  must(await payBill(actor, { billId: openBill.id, amountCents: openBill.balanceCents, paidOn: new Date("2026-10-25T12:00:00Z"), method: "ACH", reference: "OCT-VPAY" }), "pay bill");
  for (const day of ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]) {
    const batch = must(await createBatch(actor, { productId: product.id, plannedQty: 20, notes: `OCT2026 batch ${day}`, isExample: true }), `batch ${day}`);
    must(await startBatch(actor, batch.id, new Date(`${day}T12:00:00Z`)), `start ${day}`);
    const finished = must(await finishBatch(actor, { batchId: batch.id, actualQty: 20, closedOn: new Date(`${day}T15:00:00Z`) }), `finish ${day}`);
    const specs = await prisma.qualitySpec.findMany({ where: { productId: product.id } });
    must(await releaseLot(actor, {
      lotId: finished.lotId,
      releasedOn: new Date(`${day}T16:00:00Z`),
      results: specs.map((spec) => ({ parameter: spec.parameter, value: spec.target != null ? Number(spec.target) : 7 })),
      confirmation: "RELEASE",
    }), `release ${day}`);
  }
  const schedule = await buildSchedule("2026-10-06", 4);
  const chosen = schedule.rows.filter((row) => row.suggested > 0).slice(0, 4);
  if (chosen.length) {
    const released = must(await releaseSchedule(actor, { asOf: "2026-10-06", windowWeeks: 4, emailTo: "trevor@sper.example", lines: chosen }), "trevor");
    await emailSchedule(released.id, "trevor@sper.example");
  }
  const creditInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: made[0] }, include: { lines: true } });
  const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: creditInvoice.orderId ?? "" }, include: { lines: true } });
  must(await issueCreditMemo(actor, {
    invoiceId: creditInvoice.id,
    amountCents: 500,
    issuedOn: new Date("2026-10-22T12:00:00Z"),
    reason: "Example return of one bag. Approved by FFA.",
    restockLotId: delivery.lines[0]?.lotId,
    restockQty: 1,
  }), "credit");
  const other = await prisma.invoice.findFirstOrThrow({ where: { id: { not: creditInvoice.id }, balanceCents: { gt: 1000 }, notes: { contains: "OCT2026 direct" } } });
  must(await issueCreditMemo(actor, {
    invoiceId: other.id,
    amountCents: 300,
    issuedOn: new Date("2026-10-23T12:00:00Z"),
    reason: "Example price credit. Approved by FFA.",
  }), "credit memo");
}

async function party(actor: Actor, code: string, name: string, channel: "EXPORT" | "WALMART") {
  const existing = await prisma.party.findUnique({ where: { code } });
  if (existing) return existing.id;
  const saved = must(await saveParty(actor, { ...partyBlank, code, name, isCustomer: true, isVendor: false, channel, notes: "Example channel customer." } as PartyInput), code);
  return saved.id;
}

async function expensesAndPayroll(actor: Actor) {
  if (!(await prisma.journalEntry.findFirst({ where: { memo: "Example October rent" } }))) {
    must(await postManualJournal(actor, { date: new Date("2026-10-01T12:00:00Z"), memo: "Example October rent", lines: [{ accountCode: CODES.rent, debitCents: 250000, creditCents: 0 }, { accountCode: CODES.cash, debitCents: 0, creditCents: 250000 }] }), "rent");
    must(await postManualJournal(actor, { date: new Date("2026-10-08T12:00:00Z"), memo: "Example October utilities", lines: [{ accountCode: CODES.utilities, debitCents: 48000, creditCents: 0 }, { accountCode: CODES.cash, debitCents: 0, creditCents: 48000 }] }), "utilities");
    must(await postManualJournal(actor, { date: new Date("2026-10-15T12:00:00Z"), memo: "Example October freight", lines: [{ accountCode: CODES.freight, debitCents: 32000, creditCents: 0 }, { accountCode: CODES.cash, debitCents: 0, creditCents: 32000 }] }), "freight");
  }
  if (!(await prisma.payRun.findFirst({ where: { notes: { contains: "October example payroll" } } }))) {
    const people = await prisma.employee.findMany({ where: { active: true } });
    const run = must(await createPayRun(actor, {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      payDate: "2026-10-31",
      mode: "PROVIDER",
      lines: people.slice(0, 3).map((person) => ({
        employeeId: person.id,
        hours: person.payType === "HOURLY" ? 160 : 0,
        grossCents: person.payType === "HOURLY" ? 400000 : person.rateCents,
        entered: { federalWithholdingCents: 40000, socialSecurityCents: 24800, medicareCents: 5800, futaCents: 0, floridaCents: 2000 },
      })),
    }), "payroll");
    await prisma.payRun.update({ where: { id: run.id }, data: { notes: "October example payroll. Amounts are fictitious." } });
    must(await postPayRun(actor, run.id), "post payroll");
  }
}

async function audit() {
  const lines = await prisma.journalLine.findMany({ include: { account: true, entry: true } });
  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0);
  const net = (code: string) => lines.filter((line) => line.account.code === code).reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
  const invoices = await prisma.invoice.findMany();
  const bills = await prisma.vendorBill.findMany();
  const arSub = invoices.reduce((sum, invoice) => sum + (invoice.status === "VOID" ? 0 : invoice.balanceCents), 0);
  const apSub = bills.reduce((sum, bill) => sum + bill.balanceCents, 0);
  const stock = await currentStock();
  let negative = 0;
  let lotValue = 0;
  for (const lot of stock) {
    for (const place of lot.locations) if (place.qty < -0.0001) negative += 1;
    lotValue += valueCents(lotQty(lot), lot.unitCost);
  }
  const inventoryGl = net(CODES.invRaw) + net(CODES.invFg) + net(CODES.wip) + net(CODES.packaging);
  const cogs = net(CODES.cogs);
  const waiting = await prisma.delivery.findMany({ where: { invoice: null }, include: { lines: true } });
  const uninvoiced = waiting.reduce((sum, delivery) => sum + delivery.lines.reduce((inner, line) => inner + line.cogsCents, 0), 0);
  const relieved = lines.filter((line) => ["1200", "1210", "1220", "1240"].includes(line.account.code) && (line.entry.source === "SHIPMENT" || line.entry.source === "RETURN")).reduce((sum, line) => sum + line.creditCents - line.debitCents, 0);
  const missingJournal = invoices.filter((invoice) => invoice.status !== "VOID" && !invoice.salesJournalId).map((invoice) => invoice.number);
  const prefixes = ["S-", "A-", "W-", "E-"];
  const gaps = prefixes.flatMap((prefix) => numberGaps(invoices.filter((invoice) => invoice.number.startsWith(prefix)).map((invoice) => invoice.number)).map((gap) => `${prefix}${gap}`));
  const deposit = await prisma.journalEntry.findFirst({ where: { source: "AMAZON_TRANSFER", sourceId: "OCT2026SETTLE" }, include: { lines: { include: { account: true } } } });
  const depositCents = deposit ? (deposit.lines.find((line) => line.account.code === "1000")?.debitCents ?? 0) : 0;
  const bank = await prisma.statementLine.findFirst({ where: { description: { contains: "OCT2026SETTLE" }, reconciled: true } });
  const logged = await prisma.auditLog.count();
  const checks = [
    ["Trial balance", debit === credit, `${debit} vs ${credit}`],
    ["AR ties", net(CODES.ar) === arSub, `GL ${net(CODES.ar)} sub ${arSub}`],
    ["AP ties", net(CODES.ap) === apSub, `GL ${net(CODES.ap)} sub ${apSub}`],
    ["Inventory ties", inventoryGl === lotValue, `GL ${inventoryGl} lots ${lotValue}`],
    ["COGS equals relief", cogs + uninvoiced === relieved, `COGS ${cogs} plus not invoiced ${uninvoiced} vs relieved ${relieved}`],
    ["Every invoice has a journal", missingJournal.length === 0, missingJournal.slice(0, 5).join(", ") || "yes"],
    ["No negative stock", negative === 0, String(negative)],
    ["No numbering gaps", gaps.length === 0, gaps.slice(0, 8).join(", ") || "none"],
    ["Amazon deposit ties", Boolean(bank) && bank?.amountCents === depositCents, `bank ${bank?.amountCents} books ${depositCents}`],
    ["Audit log has rows", logged > 0, String(logged)],
  ] as const;
  for (const [name, pass, detail] of checks) console.log(`${pass ? "PASS" : "FAIL"}\t${name}\t${detail}`);
  const october = invoices.filter((invoice) => invoice.issuedOn >= new Date("2026-10-01") && invoice.issuedOn < new Date("2026-11-01") && invoice.status !== "VOID");
  console.log("October invoices", october.length, "sales cents", october.reduce((sum, invoice) => sum + invoice.subtotalCents, 0));
}

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
