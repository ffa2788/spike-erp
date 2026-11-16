"use server";

import { parseDateInput } from "@/lib/dates";
import { parseDollars, parseQty } from "@/lib/pricing";
import { addFormulaVersion, addTaxRate, replaceSpecs, saveParty, saveProduct, setDefaultFormula } from "@/lib/services/masters";
import { adjustLot, importBankStatement, matchAllSuggestions, postManualJournal, recordStatementLine, transferLot } from "@/lib/services/money";
import { billReceipt, cancelPurchaseOrder, payBill, receivePurchaseOrder, savePurchaseOrder } from "@/lib/services/purchasing";
import { createBatch, finishBatch, releaseLot, rejectLot, startBatch } from "@/lib/services/production";
import { acceptQuote, cancelOrder, invoiceDelivery, markQuote, payInvoice, reviseQuote, saveQuote, shipOrder, voidInvoice } from "@/lib/services/sales";
import type { CreditTermName, DiscountKindName, IncotermName } from "@/lib/commercial";
import { CREDIT_TERMS, INCOTERMS } from "@/lib/commercial";
import { prisma } from "@/lib/db";
import { requireCan } from "./actor";
import { fail, finish, succeed } from "./http";

export async function setProductPathAction(formData: FormData) {
  await requireCan("editMasters");
  const id = text(formData, "id");
  const path = text(formData, "path");
  if (path !== "RESALE" && path !== "REPACK" && path !== "MANUFACTURED") fail(`/products/${id}`, "Choose resale, repack, or manufactured.");
  await prisma.product.update({ where: { id }, data: { path } });
  succeed(`/products/${id}`, path === "RESALE" ? "This item is sold as-is." : path === "REPACK" ? "This item is repacked. The formula does not change." : "This item is manufactured from a formula.");
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function day(formData: FormData, key: string, path: string) {
  const value = parseDateInput(text(formData, key));
  if (!value) fail(path, "Enter a real date.");
  return value;
}

function parseDiscount(raw: string, path: string): { kind: DiscountKindName; value: number } {
  const text = raw.trim();
  if (!text) return { kind: "NONE", value: 0 };
  if (text.endsWith("%")) {
    const percent = Number(text.slice(0, -1));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) fail(path, "A percent discount looks like 10%.");
    return { kind: "PERCENT", value: Math.round(percent * 100) };
  }
  const dollars = parseDollars(text);
  if (dollars == null || dollars < 0) fail(path, "A discount looks like 10% or 5.00.");
  return { kind: "AMOUNT", value: Math.round(dollars * 100) };
}

function linesFrom(formData: FormData, path: string) {
  const productIds = formData.getAll("productId").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("specialPrice").map(String);
  const discounts = formData.getAll("lineDiscount").map(String);
  const lines = [];
  for (let i = 0; i < productIds.length; i++) {
    if (!productIds[i] || !qtys[i]) continue;
    const qty = parseQty(qtys[i]);
    if (!qty) fail(path, "Enter a quantity greater than zero.");
    const special = prices[i] ? parseDollars(prices[i]) : null;
    if (prices[i] && special == null) fail(path, "A special price must look like 2.40.");
    const discount = parseDiscount(discounts[i] ?? "", path);
    lines.push({ productId: productIds[i], qty, specialPrice: special, discountKind: discount.kind, discountValue: discount.value });
  }
  return lines;
}

function termsFrom(formData: FormData, path: string) {
  const incoterm = text(formData, "incoterm") || "EXW";
  const creditTerm = text(formData, "creditTerm") || "NET_30";
  if (!INCOTERMS.includes(incoterm as IncotermName)) fail(path, "Choose a shipping term.");
  if (!CREDIT_TERMS.some((term) => term.code === creditTerm)) fail(path, "Choose payment terms.");
  const freight = text(formData, "freight") ? parseDollars(text(formData, "freight")) : 0;
  const insurance = text(formData, "insurance") ? parseDollars(text(formData, "insurance")) : 0;
  if (freight == null || insurance == null) fail(path, "Freight and insurance must look like 75.00.");
  const early = text(formData, "earlyPayPercent");
  const earlyPercent = early ? Number(early) : 0;
  if (early && (!Number.isFinite(earlyPercent) || earlyPercent < 0 || earlyPercent > 100)) fail(path, "Early-pay percent looks like 2.");
  const doc = parseDiscount(text(formData, "docDiscount"), path);
  return {
    incoterm: incoterm as IncotermName,
    namedPlace: text(formData, "namedPlace"),
    currency: text(formData, "currency") || "USD",
    creditTerm: creditTerm as CreditTermName,
    customNetDays: Number(text(formData, "customNetDays") || "30"),
    earlyPayBps: Math.round(earlyPercent * 100),
    earlyPayDays: Number(text(formData, "earlyPayDays") || "0"),
    freightCents: Math.round((freight ?? 0) * 100),
    insuranceCents: Math.round((insurance ?? 0) * 100),
    docDiscountKind: doc.kind,
    docDiscountValue: doc.value,
  };
}

export async function createQuote(formData: FormData) {
  const actor = await requireCan("sell");
  const back = "/sales/quotes/new";
  const result = await saveQuote(actor, {
    partyId: text(formData, "partyId"),
    issuedOn: day(formData, "issuedOn", back),
    validUntil: day(formData, "validUntil", back),
    notes: text(formData, "notes"),
    lines: linesFrom(formData, back),
    terms: termsFrom(formData, back),
  });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Quote saved.", `/sales/quotes/${result.value.id}`);
}

export async function quoteMark(formData: FormData) {
  const actor = await requireCan("sell");
  const id = text(formData, "id");
  const status = text(formData, "status");
  const back = `/sales/quotes/${id}`;
  if (status !== "SENT" && status !== "REJECTED" && status !== "EXPIRED") fail(back, "That is not a quote status.");
  finish(back, await markQuote(actor, id, status), "Quote updated.");
}

export async function quoteRevise(formData: FormData) {
  const actor = await requireCan("sell");
  const id = text(formData, "id");
  const result = await reviseQuote(actor, id);
  if (!result.ok) fail(`/sales/quotes/${id}`, result.error);
  finish(`/sales/quotes/${id}`, result, "Revision saved.", `/sales/quotes/${result.value.id}`);
}

export async function invoiceVoid(formData: FormData) {
  const actor = await requireCan("sell");
  const id = text(formData, "id");
  finish(`/sales/invoices/${id}`, await voidInvoice(actor, id), "Invoice voided. The number stays on file.");
}

export async function quoteAccept(formData: FormData) {
  const actor = await requireCan("sell");
  const id = text(formData, "id");
  const result = await acceptQuote(actor, id);
  if (!result.ok) fail(`/sales/quotes/${id}`, result.error);
  finish(`/sales/quotes/${id}`, result, "Order created.", `/sales/orders/${result.value.orderId}`);
}

export async function orderShip(formData: FormData) {
  const actor = await requireCan("ship");
  const id = text(formData, "id");
  const back = `/sales/orders/${id}`;
  const result = await shipOrder(actor, {
    orderId: id,
    shipAll: text(formData, "shipAll") === "yes",
    shippedOn: day(formData, "shippedOn", back),
    carrier: text(formData, "carrier"),
    tracking: text(formData, "tracking"),
    notes: text(formData, "notes"),
  });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Shipment recorded.", `/sales/deliveries/${result.value.deliveryId}`);
}

export async function orderCancel(formData: FormData) {
  const actor = await requireCan("sell");
  const id = text(formData, "id");
  if (text(formData, "confirm") !== "yes") fail(`/sales/orders/${id}`, "Tick the box to cancel the order.");
  finish(`/sales`, await cancelOrder(actor, id), "Order cancelled.", "/sales");
}

export async function deliveryInvoice(formData: FormData) {
  const actor = await requireCan("sell");
  const id = text(formData, "id");
  const back = `/sales/deliveries/${id}`;
  const result = await invoiceDelivery(actor, id, day(formData, "issuedOn", back));
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Invoice created.", `/sales/invoices/${result.value.invoiceId}`);
}

export async function invoicePay(formData: FormData) {
  const actor = await requireCan("postMoney");
  const id = text(formData, "id");
  const back = `/sales/invoices/${id}`;
  const dollars = parseDollars(text(formData, "amount"));
  if (dollars == null) fail(back, "Enter the amount received.");
  const result = await payInvoice(actor, {
    invoiceId: id,
    amountCents: Math.round(dollars * 100),
    paidOn: day(formData, "paidOn", back),
    method: text(formData, "method"),
    reference: text(formData, "reference"),
  });
  finish(back, result, "Payment recorded.");
}

export async function createPo(formData: FormData) {
  const actor = await requireCan("editMasters");
  const back = "/purchasing/orders/new";
  const productIds = formData.getAll("productId").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("unitPrice").map(String);
  const lines = [];
  for (let i = 0; i < productIds.length; i++) {
    if (!productIds[i]) continue;
    const qty = parseQty(qtys[i] ?? "");
    const price = parseDollars(prices[i] ?? "");
    if (!qty || price == null) fail(back, "Each line needs a quantity and a price.");
    lines.push({ productId: productIds[i], qty, unitPrice: price, allowOneDollar: formData.getAll("allowOneDollar")[i] === "yes" });
  }
  const result = await savePurchaseOrder(actor, {
    partyId: text(formData, "partyId"),
    orderedOn: day(formData, "orderedOn", back),
    expectedOn: text(formData, "expectedOn") ? day(formData, "expectedOn", back) : null,
    notes: text(formData, "notes"),
    send: text(formData, "send") === "yes",
    lines,
  });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Purchase order saved.", `/purchasing/orders/${result.value.id}`);
}

export async function poReceive(formData: FormData) {
  const actor = await requireCan("receive");
  const id = text(formData, "id");
  const back = `/purchasing/orders/${id}`;
  const ids = formData.getAll("orderLineId").map(String);
  const qtys = formData.getAll("qty").map(String);
  const lots = formData.getAll("supplierLot").map(String);
  const expiries = formData.getAll("expiresOn").map(String);
  const lines = [];
  for (let i = 0; i < ids.length; i++) {
    if (!qtys[i]) continue;
    const qty = parseQty(qtys[i]);
    if (!qty) fail(back, "Received quantity must be greater than zero.");
    lines.push({
      orderLineId: ids[i],
      qty,
      supplierLot: lots[i] ?? "",
      expiresOn: expiries[i] ? parseDateInput(expiries[i]) : null,
    });
  }
  const result = await receivePurchaseOrder(actor, {
    orderId: id,
    receivedOn: day(formData, "receivedOn", back),
    notes: text(formData, "notes"),
    lines,
  });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Goods received. The lots are waiting for quality.", `/purchasing/receipts/${result.value.receiptId}`);
}

export async function poCancel(formData: FormData) {
  const actor = await requireCan("editMasters");
  const id = text(formData, "id");
  if (text(formData, "confirm") !== "yes") fail(`/purchasing/orders/${id}`, "Tick the box to cancel.");
  finish("/purchasing", await cancelPurchaseOrder(actor, id), "Purchase order cancelled.", "/purchasing");
}

export async function receiptBill(formData: FormData) {
  const actor = await requireCan("postMoney");
  const id = text(formData, "id");
  const back = `/purchasing/receipts/${id}`;
  const ids = formData.getAll("receiptLineId").map(String);
  const prices = formData.getAll("unitPrice").map(String);
  const lines = ids.map((receiptLineId, index) => {
    const price = parseDollars(prices[index] ?? "");
    if (price == null) fail(back, "Enter the billed price.");
    return { receiptLineId, unitPrice: price, allowOneDollar: formData.get(`allow-${receiptLineId}`) === "yes" };
  });
  const result = await billReceipt(actor, {
    receiptId: id,
    vendorRef: text(formData, "vendorRef"),
    billedOn: day(formData, "billedOn", back),
    lines,
  });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Supplier bill recorded.", `/purchasing/bills/${result.value.billId}`);
}

export async function billPay(formData: FormData) {
  const actor = await requireCan("postMoney");
  const id = text(formData, "id");
  const back = `/purchasing/bills/${id}`;
  const dollars = parseDollars(text(formData, "amount"));
  if (dollars == null) fail(back, "Enter the amount paid.");
  finish(back, await payBill(actor, {
    billId: id,
    amountCents: Math.round(dollars * 100),
    paidOn: day(formData, "paidOn", back),
    method: text(formData, "method"),
    reference: text(formData, "reference"),
  }), "Payment recorded.");
}

export async function batchCreate(formData: FormData) {
  const actor = await requireCan("produce");
  const back = "/production/new";
  const qty = parseQty(text(formData, "plannedQty"));
  if (!qty) fail(back, "Enter the quantity to make.");
  const result = await createBatch(actor, { productId: text(formData, "productId"), plannedQty: qty, notes: text(formData, "notes") });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Batch planned.", `/production/${result.value.id}`);
}

export async function batchStart(formData: FormData) {
  const actor = await requireCan("produce");
  const id = text(formData, "id");
  const back = `/production/${id}`;
  finish(back, await startBatch(actor, id, day(formData, "startedOn", back)), "Ingredients consumed. The batch is in process.");
}

export async function batchFinish(formData: FormData) {
  const actor = await requireCan("produce");
  const id = text(formData, "id");
  const back = `/production/${id}`;
  const qty = parseQty(text(formData, "actualQty"));
  if (!qty) fail(back, "Enter the quantity you made.");
  const result = await finishBatch(actor, { batchId: id, actualQty: qty, closedOn: day(formData, "closedOn", back) });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Lot created and waiting for quality.", `/inventory/${result.value.lotId}`);
}

export async function lotRelease(formData: FormData) {
  const actor = await requireCan("releaseQc");
  const id = text(formData, "id");
  const back = `/inventory/${id}`;
  const parameters = formData.getAll("parameter").map(String);
  const values = formData.getAll("value").map(String);
  const results = [];
  for (let i = 0; i < parameters.length; i++) {
    if (!parameters[i] || !values[i]) continue;
    const value = Number(values[i]);
    if (!Number.isFinite(value)) fail(back, `Enter a number for ${parameters[i]}.`);
    results.push({ parameter: parameters[i], value });
  }
  finish(back, await releaseLot(actor, {
    lotId: id,
    releasedOn: day(formData, "releasedOn", back),
    results,
    confirmation: text(formData, "confirmation"),
  }), "Lot released.");
}

export async function lotReject(formData: FormData) {
  const actor = await requireCan("releaseQc");
  const id = text(formData, "id");
  finish(`/inventory/${id}`, await rejectLot(actor, id, text(formData, "note")), "Lot rejected.");
}

export async function lotAdjust(formData: FormData) {
  const actor = await requireCan("manualJournal");
  const id = text(formData, "id");
  const back = `/inventory/${id}`;
  const qty = Number(text(formData, "newQty"));
  if (!Number.isFinite(qty)) fail(back, "Enter the corrected quantity.");
  finish(back, await adjustLot(actor, {
    lotId: id,
    locationId: text(formData, "locationId"),
    newQty: qty,
    reason: text(formData, "reason"),
    date: day(formData, "date", back),
  }), "Quantity corrected.");
}

export async function lotTransfer(formData: FormData) {
  const actor = await requireCan("ship");
  const id = text(formData, "id");
  const back = `/inventory/${id}`;
  const qty = parseQty(text(formData, "qty"));
  if (!qty) fail(back, "Enter a quantity to move.");
  finish(back, await transferLot(actor, {
    lotId: id,
    fromLocationId: text(formData, "fromLocationId"),
    toLocationId: text(formData, "toLocationId"),
    qty,
    date: day(formData, "date", back),
  }), "Lot moved.");
}

export async function savePartyAction(formData: FormData) {
  const actor = await requireCan("editMasters");
  const kind = text(formData, "kind");
  const back = text(formData, "id") ? `/${kind}/${text(formData, "id")}` : `/${kind}/new`;
  const credit = parseDollars(text(formData, "creditLimit") || "0");
  if (credit == null) fail(back, "Credit limit must be a dollar amount.");
  const result = await saveParty(actor, {
    id: text(formData, "id") || undefined,
    code: text(formData, "code"),
    name: text(formData, "name"),
    isCustomer: kind === "customers" || formData.get("isCustomer") === "yes",
    isVendor: kind === "vendors" || formData.get("isVendor") === "yes",
    channel: (text(formData, "channel") || "DIRECT") as "DIRECT",
    contactName: text(formData, "contactName"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    billStreet: text(formData, "billStreet"),
    billCity: text(formData, "billCity"),
    billState: text(formData, "billState"),
    billZip: text(formData, "billZip"),
    shipStreet: text(formData, "shipStreet"),
    shipCity: text(formData, "shipCity"),
    shipState: text(formData, "shipState"),
    shipZip: text(formData, "shipZip"),
    taxLocality: text(formData, "taxLocality"),
    paymentTermsDays: Number(text(formData, "paymentTermsDays") || "30"),
    creditLimitCents: Math.round(credit * 100),
    taxExempt: formData.get("taxExempt") === "yes",
    exemptionNumber: text(formData, "exemptionNumber"),
    exemptionState: text(formData, "exemptionState"),
    exemptionExpires: text(formData, "exemptionExpires") ? day(formData, "exemptionExpires", back) : null,
    leadTimeDays: text(formData, "leadTimeDays") ? Number(text(formData, "leadTimeDays")) : null,
    notes: text(formData, "notes"),
    active: formData.get("active") !== "no",
    ...(kind === "vendors"
      ? {
          w9OnFile: formData.get("w9OnFile") === "yes",
          w9ReceivedOn: text(formData, "w9ReceivedOn") ? day(formData, "w9ReceivedOn", back) : null,
          infoReturn: (["NONE", "NEC", "MISC"].includes(text(formData, "infoReturn")) ? text(formData, "infoReturn") : "NONE") as "NONE" | "NEC" | "MISC",
        }
      : {}),
  });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Saved.", `/${kind}/${result.value.id}`);
}

export async function saveProductAction(formData: FormData) {
  const actor = await requireCan("editMasters");
  const id = text(formData, "id");
  const back = id ? `/products/${id}` : "/products/new";
  const cost = parseDollars(text(formData, "standardCost") || "0");
  const priceRaw = text(formData, "listPrice");
  const price = priceRaw ? parseDollars(priceRaw) : null;
  if (cost == null || (priceRaw && price == null)) fail(back, "Cost and price must look like 2.40.");
  const result = await saveProduct(actor, {
    id: id || undefined,
    sku: text(formData, "sku"),
    name: text(formData, "name"),
    kind: text(formData, "kind") as "RAW",
    unit: text(formData, "unit"),
    category: text(formData, "category"),
    standardCost: cost ?? 0,
    listPrice: price,
    allowOneDollar: formData.get("allowOneDollar") === "yes",
    sellable: formData.get("sellable") === "yes",
    taxable: formData.get("taxable") !== "no",
    trackInventory: formData.get("trackInventory") !== "no",
    minQty: Number(text(formData, "minQty") || "0"),
    shelfLifeDays: text(formData, "shelfLifeDays") ? Number(text(formData, "shelfLifeDays")) : null,
    pack: text(formData, "pack"),
    casNumber: text(formData, "casNumber"),
    preferredVendorId: text(formData, "preferredVendorId") || null,
    leadTimeDays: text(formData, "leadTimeDays") ? Number(text(formData, "leadTimeDays")) : null,
    nsfCertified: formData.get("nsfCertified") === "yes",
    nsfCertNumber: text(formData, "nsfCertNumber"),
    nsfBody: text(formData, "nsfBody"),
    nsfUses: text(formData, "nsfUses"),
    nsfIssuedOn: text(formData, "nsfIssuedOn") ? day(formData, "nsfIssuedOn", back) : null,
    nsfExpiresOn: text(formData, "nsfExpiresOn") ? day(formData, "nsfExpiresOn", back) : null,
    nsfFormulaVersion: text(formData, "nsfFormulaVersion") ? Number(text(formData, "nsfFormulaVersion")) : null,
    nsfClaim: text(formData, "nsfClaim"),
    ghsSignal: text(formData, "ghsSignal"),
    ghsPictograms: text(formData, "ghsPictograms"),
    hazardStatements: text(formData, "hazardStatements"),
    precautionary: text(formData, "precautionary"),
    notes: text(formData, "notes"),
    active: formData.get("active") !== "no",
  });
  if (!result.ok) fail(back, result.error);
  finish(back, result, "Product saved.", `/products/${result.value.id}`);
}

export async function formulaAction(formData: FormData) {
  const actor = await requireCan("editMasters");
  const productId = text(formData, "productId");
  const back = `/products/${productId}`;
  const ingredientIds = formData.getAll("ingredientId").map(String);
  const percents = formData.getAll("percent").map(String);
  const lines = [];
  for (let i = 0; i < ingredientIds.length; i++) {
    if (!ingredientIds[i] || !percents[i]) continue;
    const percent = Number(percents[i]);
    if (!(percent > 0)) fail(back, "Percents must be greater than zero.");
    lines.push({ ingredientId: ingredientIds[i], percent });
  }
  const qty = parseQty(text(formData, "batchQty"));
  if (!qty) fail(back, "Enter the batch size.");
  finish(back, await addFormulaVersion(actor, {
    productId,
    batchQty: qty,
    notes: text(formData, "notes"),
    makeDefault: formData.get("makeDefault") === "yes",
    lines,
  }), "Formula version saved.");
}

export async function defaultFormulaAction(formData: FormData) {
  const actor = await requireCan("editMasters");
  const productId = text(formData, "productId");
  finish(`/products/${productId}`, await setDefaultFormula(actor, text(formData, "formulaId")), "Default formula updated.");
}

export async function specsAction(formData: FormData) {
  const actor = await requireCan("editMasters");
  const productId = text(formData, "productId");
  const parameters = formData.getAll("parameter").map(String);
  const units = formData.getAll("unit").map(String);
  const mins = formData.getAll("min").map(String);
  const maxes = formData.getAll("max").map(String);
  const specs = parameters.map((parameter, index) => ({
    parameter,
    unit: units[index] ?? "",
    min: mins[index] ? Number(mins[index]) : null,
    max: maxes[index] ? Number(maxes[index]) : null,
    target: null,
  }));
  finish(`/products/${productId}`, await replaceSpecs(actor, productId, specs), "Quality checks saved.");
}

export async function journalAction(formData: FormData) {
  const actor = await requireCan("manualJournal");
  const back = "/money/journal/new";
  const codes = formData.getAll("accountCode").map(String);
  const debits = formData.getAll("debit").map(String);
  const credits = formData.getAll("credit").map(String);
  const lines = [];
  for (let i = 0; i < codes.length; i++) {
    if (!codes[i]) continue;
    const debit = Math.round((parseDollars(debits[i] || "0") ?? NaN) * 100);
    const credit = Math.round((parseDollars(credits[i] || "0") ?? NaN) * 100);
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) fail(back, "Amounts must look like 10.00.");
    if (debit === 0 && credit === 0) continue;
    lines.push({ accountCode: codes[i], debitCents: debit, creditCents: credit });
  }
  const result = await postManualJournal(actor, { date: day(formData, "date", back), memo: text(formData, "memo"), lines });
  finish(back, result, "Journal posted.", "/money");
}

export async function bankImportAction(formData: FormData) {
  const actor = await requireCan("postMoney");
  const back = "/money/reconcile";
  const file = formData.get("file");
  const csv = file instanceof File && file.size > 0 ? await file.text() : text(formData, "csv");
  const ending = parseDollars(text(formData, "ending"));
  if (ending == null) fail(back, "Enter the ending balance from the statement.");
  finish(back, await importBankStatement(actor, {
    csv,
    fileName: file instanceof File ? file.name : "pasted.csv",
    statementDate: day(formData, "statementDate", back),
    endingBalanceCents: Math.round(ending * 100),
  }), "Statement loaded.");
}

export async function bankMatchAction() {
  const actor = await requireCan("postMoney");
  const result = await matchAllSuggestions(actor);
  if (!result.ok) fail("/money/reconcile", result.error);
  finish("/money/reconcile", result, `Matched ${result.value.matched} lines.`);
}

export async function bankFeeAction(formData: FormData) {
  const actor = await requireCan("postMoney");
  finish("/money/reconcile", await recordStatementLine(actor, text(formData, "id")), "Bank line recorded in the books.");
}

export async function taxAction(formData: FormData) {
  const actor = await requireCan("postMoney");
  const percent = Number(text(formData, "percent"));
  if (!Number.isFinite(percent)) fail("/settings/tax", "Enter the percent, such as 6 or 1.");
  finish("/settings/tax", await addTaxRate(actor, {
    state: text(formData, "state"),
    locality: text(formData, "locality"),
    name: text(formData, "name"),
    rateBps: Math.round(percent * 100),
  }), "Tax rate added.");
}

export async function userAction(formData: FormData) {
  const actor = await requireCan("manageUsers");
  const { prisma } = await import("@/lib/db");
  const bcrypt = (await import("bcryptjs")).default;
  const email = text(formData, "email").toLowerCase();
  const name = text(formData, "name");
  const role = text(formData, "role");
  const password = text(formData, "password");
  if (!email.includes("@") || !name || password.length < 8) fail("/settings/users", "Enter a name, email, and a password of at least 8 characters.");
  if (!["OWNER", "PARTNER", "WAREHOUSE", "READONLY"].includes(role)) fail("/settings/users", "Choose a role.");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) fail("/settings/users", "That email is already in use.");
  await prisma.user.create({
    data: { email, name, role: role as "OWNER", passwordHash: await bcrypt.hash(password, 10), totpEnabled: false },
  });
  const { audit } = await import("@/lib/services/shared");
  await prisma.$transaction(async (tx) => {
    await audit(tx, actor, "create", "User", email, `Added user ${name} as ${role}.`);
  });
  const { succeed } = await import("./http");
  succeed("/settings/users", "User added. They will set up their sign-in code on first login.");
}
