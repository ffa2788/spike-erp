import { prisma } from "./db";
import { todayInput, parseDateInput, toDateInput } from "./dates";
import { lotQty, stockBuckets } from "./inventory";
import { assessBooks, currentStock } from "./read-models";
import { htmlToPdf } from "./html-to-pdf";
import { deliverEmail, emailSetup } from "./email";
import { documentHtml, money } from "./spike-documents";
import { loadBuySoon } from "./services/buy-soon";
import { agingReport, balanceReport, customerReport, mrpReport, productReport, profitReport, salesReport } from "./services/owner-reports";
import { applyHelpAnswer } from "./help";
import { botManualResult, parseManual } from "./manual";
import { shippedManual } from "./manual-source";
import { keysMatch, scopeAllows, type SpikeScope } from "./spike-auth";
import { buildPlan } from "./services/mrp-run";
import { buildSchedule, emailSchedule, releaseSchedule } from "./services/schedule-run";
import { saveAmazonSkuMaps } from "./services/amazon-import";
import { savePurchaseOrder } from "./services/purchasing";
import { acceptQuote, invoiceDelivery, payInvoice, saveQuote, shipOrder } from "./services/sales";
import type { Actor } from "./services/shared";
import { buildPlan as buildProductionPlan, planDocumentHtml } from "./work-list-mail";

export const SPIKE_BOT: Actor = { id: "spike-bot", name: "SPIKE bot", role: "OWNER" };

export type SpikeResult = { status: number; body: unknown; pdf?: Uint8Array; filename?: string };

type Query = Record<string, string>;

export async function authenticateApiKey(header: string | null): Promise<{ ok: true; scopes: string; keyId: string } | { ok: false; error: string }> {
  const raw = header?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!raw.startsWith("spike_")) return { ok: false, error: "Send Authorization: Bearer spike_..." };
  const keys = await prisma.apiKey.findMany({ where: { revokedAt: null } });
  const key = keys.find((item) => keysMatch(item.hash, raw));
  if (!key) return { ok: false, error: "That API key is not valid." };
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { ok: true, scopes: key.scopes, keyId: key.id };
}

export async function callSpike(method: string, path: string, query: Query, body: unknown, scopes: string): Promise<SpikeResult> {
  const parts = path.split("/").filter(Boolean);
  const verb = method.toUpperCase();
  const need = scopeFor(verb, parts);
  if (!scopeAllows(scopes, need)) return { status: 403, body: { error: `This key needs the ${need} scope.` } };
  try {
    return await route(verb, parts, query, body);
  } catch (error) {
    console.error(error);
    return { status: 500, body: { error: "The request failed. Nothing was saved." } };
  }
}

export async function auditSpike(path: string, status: number, summary: string) {
  await prisma.auditLog.create({
    data: {
      userName: "SPIKE bot",
      action: "api",
      entity: "Api",
      entityId: path.slice(0, 180) || "/",
      summary: summary.slice(0, 500),
    },
  });
}

function scopeFor(method: string, parts: string[]): SpikeScope {
  const head = parts[0] ?? "";
  if (head === "manual" || head === "help-requests" || head === "alerts") return "read";
  if (method === "GET") return "read";
  if (head === "payments") return "money";
  if (head === "purchase-orders") return "purchasing";
  if (head === "production-plans") return "planning";
  return "sales";
}

async function route(method: string, parts: string[], query: Query, body: unknown): Promise<SpikeResult> {
  const [head, id, action] = parts;
  if (head === "manual") return manualRoute(method);
  if (method === "GET" && head === "alerts" && id === "low-stock") return lowStock();
  if (method === "GET" && head === "reports" && id) return reportApi(id, query);
  if (method === "GET" && head === "help-requests" && !id) return listHelp(query.status ?? "open");
  if (method === "POST" && head === "help-requests" && id && action === "answer") return answerHelp(id, body);
  if (method === "GET" && head === "search") return search(query.q ?? "");
  if (method === "GET" && head === "dashboard") return dashboard();
  if (method === "GET" && head === "customers" && !id) return listCustomers(query.q ?? "");
  if (method === "GET" && head === "customers" && id) return getCustomer(id);
  if (method === "GET" && head === "vendors" && !id) return listVendors(query.q ?? "");
  if (method === "GET" && head === "vendors" && id) return getVendor(id);
  if (method === "GET" && head === "products" && !id) return listProducts(query.q ?? "");
  if (method === "GET" && head === "products" && id) return getProduct(id);
  if (method === "GET" && head === "inventory") return inventory();
  if (method === "GET" && head === "coverage") return coverage();
  if (method === "GET" && head === "quotes" && id && action === "pdf") return quotePdf(id);
  if (method === "GET" && head === "quotes" && id) return getQuote(id);
  if (method === "POST" && head === "quotes" && !id) return createQuote(body);
  if (method === "PATCH" && head === "quotes" && id && !action) return updateQuote(id, body);
  if (method === "POST" && head === "quotes" && id && action === "order") return convertQuote(id);
  if (method === "POST" && head === "orders" && id && action === "ship") return ship(id, body);
  if (method === "POST" && head === "orders" && id && action === "invoice") return invoiceOrder(id, body);
  if (method === "GET" && head === "invoices" && id && action === "pdf") return invoicePdf(id);
  if (method === "GET" && head === "invoices" && id) return getInvoice(id);
  if (method === "GET" && head === "purchase-orders" && id && action === "pdf") return poPdf(id);
  if (method === "POST" && head === "purchase-orders" && !id) return createPo(body);
  if (method === "GET" && head === "work-lists" && id && action === "pdf") return workListPdf(id);
  if (method === "POST" && head === "payments") return payment(body);
  if (method === "POST" && head === "production-plans" && id === "release") return releasePlan(body);
  if (method === "POST" && head === "amazon" && id === "sku-maps") return saveSkuMaps(body);
  if (method === "POST" && head === "messages" && !id) return draftMessage(body);
  if (method === "GET" && head === "messages" && id && !action) return getDraft(id);
  if (method === "POST" && head === "messages" && id && action === "confirm") return confirmDraft(id);
  return { status: 404, body: { error: "No such API path. See /api/openapi.json." } };
}

async function saveSkuMaps(body: unknown): Promise<SpikeResult> {
  const record = asRecord(body);
  const listed = Array.isArray(record.mappings) ? record.mappings : [record];
  const mappings = listed.flatMap((item) => {
    const row = asRecord(item);
    const amazonSku = text(row, "amazonSku");
    const productId = text(row, "productId");
    if (!amazonSku && !productId) return [];
    return [{ amazonSku, productId, asin: text(row, "asin") }];
  });
  const saved = await saveAmazonSkuMaps({ mappings, dryRun: record.dryRun === true });
  if (!saved.ok) return { status: 400, body: { error: saved.error } };
  return { status: 200, body: saved.value };
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function text(body: Record<string, unknown>, key: string): string {
  return String(body[key] ?? "").trim();
}

async function manualRoute(method: string): Promise<SpikeResult> {
  if (botManualResult(method) === "refuse") {
    return { status: 405, body: { error: "The bot can read the manual. It cannot change it." } };
  }
  const saved = await prisma.operatingManual.findUnique({ where: { id: "manual" } });
  const markdown = saved?.body || shippedManual();
  const doc = parseManual(markdown);
  return {
    status: 200,
    body: {
      source: saved?.body ? "saved" : "shipped",
      updatedBy: saved?.updatedBy ?? "",
      markdown,
      sections: doc.sections.map((section) => ({ id: section.id, title: section.title })),
    },
  };
}

async function listHelp(status: string): Promise<SpikeResult> {
  const allowed = ["open", "answered", "closed"];
  if (!allowed.includes(status)) return { status: 400, body: { error: "status must be open, answered, or closed." } };
  const rows = await prisma.helpRequest.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 50 });
  return {
    status: 200,
    body: {
      requests: rows.map((row) => ({
        id: row.id,
        user: row.userName,
        screen: row.screen,
        record: row.recordRef,
        message: row.message,
        status: row.status,
        answer: row.answer,
        createdAt: row.createdAt.toISOString(),
        answeredAt: row.answeredAt?.toISOString() ?? null,
      })),
    },
  };
}

async function answerHelp(id: string, body: unknown): Promise<SpikeResult> {
  const answer = text(asRecord(body), "answer");
  const row = await prisma.helpRequest.findUnique({ where: { id } });
  if (!row) return { status: 404, body: { error: "Help request not found." } };
  const check = applyHelpAnswer(row.status, answer);
  if (!check.ok) return { status: 400, body: { error: check.error } };
  const saved = await prisma.helpRequest.update({
    where: { id },
    data: { status: "answered", answer: answer.trim(), answeredBy: "SPIKE bot", answeredAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      userName: "SPIKE bot",
      action: "answer",
      entity: "HelpRequest",
      entityId: id,
      summary: `SPIKE bot answered help request from ${row.userName}.`,
    },
  });
  return { status: 200, body: { id: saved.id, status: saved.status, answer: saved.answer } };
}

async function reportApi(id: string, query: Query): Promise<SpikeResult> {
  const ask = { period: query.period, anchor: query.anchor || "2026-10-15", from: query.from, to: query.to, sort: query.sort };
  if (id === "sales") return { status: 200, body: await salesReport(ask) };
  if (id === "products") return { status: 200, body: await productReport(ask) };
  if (id === "customers") return { status: 200, body: await customerReport(ask) };
  if (id === "mrp") return { status: 200, body: { rows: await mrpReport() } };
  if (id === "profit") return { status: 200, body: await profitReport(ask) };
  if (id === "balance") return { status: 200, body: await balanceReport(query.asOf || "2026-10-31") };
  if (id === "ar") return { status: 200, body: await agingReport(query.asOf || "2026-11-18") };
  return { status: 404, body: { error: "No such report. Use sales, products, customers, mrp, profit, balance, or ar." } };
}

async function lowStock(): Promise<SpikeResult> {
  const rows = await loadBuySoon();
  return {
    status: 200,
    body: {
      alerts: rows.filter((row) => row.tone !== "ok").map((row) => ({
        sku: row.sku,
        name: row.name,
        tone: row.tone,
        onHand: row.onHand,
        unit: row.unit,
        weeklyUse: row.weeklyUse,
        weeksLeft: row.weeksLeft,
        runOut: row.runOut,
        suggestedQty: row.suggestedQty,
      })),
    },
  };
}

async function listCustomers(q: string) {
  const rows = await prisma.party.findMany({
    where: {
      isCustomer: true,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 50,
  });
  return { status: 200, body: { customers: rows.map(customerJson) } };
}

async function getCustomer(id: string) {
  const row = await prisma.party.findUnique({ where: { id } });
  if (!row?.isCustomer) return { status: 404, body: { error: "Customer not found." } };
  return { status: 200, body: { customer: customerJson(row) } };
}

function customerJson(row: { id: string; code: string; name: string; email: string; phone: string; channel: string; paymentTermsDays: number; isCustomer: boolean; isVendor: boolean }) {
  return { id: row.id, code: row.code, name: row.name, email: row.email, phone: row.phone, channel: row.channel, paymentTermsDays: row.paymentTermsDays, isCustomer: row.isCustomer, isVendor: row.isVendor };
}

async function listVendors(q: string) {
  const rows = await prisma.party.findMany({
    where: {
      isVendor: true,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 50,
  });
  return { status: 200, body: { vendors: rows.map(customerJson) } };
}

async function getVendor(id: string) {
  const row = await prisma.party.findUnique({ where: { id } });
  if (!row?.isVendor) return { status: 404, body: { error: "Vendor not found." } };
  return { status: 200, body: { vendor: customerJson(row) } };
}

async function listProducts(q: string) {
  const rows = await prisma.product.findMany({
    where: q ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { sku: "asc" },
    take: 80,
  });
  return { status: 200, body: { products: rows.map(productJson) } };
}

async function getProduct(id: string) {
  const row = await prisma.product.findUnique({ where: { id } });
  if (!row) return { status: 404, body: { error: "Product not found." } };
  return { status: 200, body: { product: productJson(row) } };
}

function productJson(row: { id: string; sku: string; name: string; kind: string; path: string; unit: string; listPrice: { toString(): string } | null; priceStatus: string }) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    kind: row.kind,
    path: row.path,
    unit: row.unit,
    listPrice: row.listPrice == null ? null : Number(row.listPrice),
    priceStatus: row.priceStatus,
  };
}

async function inventory() {
  const today = todayInput();
  const [products, stock] = await Promise.all([
    prisma.product.findMany({ where: { trackInventory: true }, orderBy: { sku: "asc" } }),
    currentStock(),
  ]);
  return {
    status: 200,
    body: {
      inventory: products.map((product) => {
        const buckets = stockBuckets(stock, product.id, today);
        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          ready: buckets.available,
          waiting: buckets.quarantine,
          valueCents: buckets.valueCents,
        };
      }),
      lots: stock.filter((lot) => lotQty(lot) > 0).map((lot) => ({
        lotId: lot.lotId,
        lotNumber: lot.lotNumber,
        productId: lot.productId,
        status: lot.qcStatus,
        qty: lotQty(lot),
      })),
    },
  };
}

async function coverage() {
  const built = await buildPlan(todayInput());
  return {
    status: 200,
    body: {
      asOf: built.asOf,
      coverage: built.coverage.map((row) => ({
        productId: row.product.id,
        sku: row.product.sku,
        name: row.product.name,
        status: row.status,
        daysOfCover: row.daysVsUsage,
        action: row.action,
        onHand: row.item.onHandReleased,
        unit: row.product.unit,
      })),
    },
  };
}

async function search(q: string) {
  if (!q) return { status: 400, body: { error: "Pass q, such as S-000001 or a customer name." } };
  const [customers, products, invoices, quotes] = await Promise.all([
    prisma.party.findMany({ where: { isCustomer: true, OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] }, take: 10 }),
    prisma.product.findMany({ where: { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }, take: 10 }),
    prisma.invoice.findMany({ where: { OR: [{ number: { equals: q, mode: "insensitive" } }, { marketplaceOrderId: { equals: q, mode: "insensitive" } }] }, take: 10 }),
    prisma.quote.findMany({ where: { number: { equals: q, mode: "insensitive" } }, take: 10 }),
  ]);
  return {
    status: 200,
    body: {
      customers: customers.map(customerJson),
      products: products.map(productJson),
      invoices: invoices.map((row) => ({ id: row.id, number: row.number, balanceCents: row.balanceCents, status: row.status })),
      quotes: quotes.map((row) => ({ id: row.id, number: row.number, status: row.status, totalCents: row.totalCents })),
    },
  };
}

async function dashboard() {
  const today = todayInput();
  const books = await assessBooks();
  const [openQuotes, ordersToShip, overdue] = await Promise.all([
    prisma.quote.count({ where: { status: { in: ["DRAFT", "SENT"] } } }),
    prisma.salesOrder.count({ where: { status: { in: ["CONFIRMED", "PARTLY_SHIPPED"] } } }),
    prisma.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] }, dueOn: { lt: new Date(`${today}T00:00:00Z`) } }, include: { party: true }, take: 10 }),
  ]);
  return {
    status: 200,
    body: {
      cashCents: books.cashCents,
      cash: money(books.cashCents),
      customersOweCents: books.arSub,
      customersOwe: money(books.arSub),
      weOweCents: books.apSub,
      weOwe: money(books.apSub),
      inventoryCents: books.inventoryLots,
      inventory: money(books.inventoryLots),
      booksAgree: books.check.ok,
      openQuotes,
      ordersToShip,
      alerts: [
        ...(!books.check.ok ? [{ tone: "bad", title: "The books do not agree", detail: books.check.problems[0] }] : []),
        ...overdue.map((invoice) => ({ tone: "bad", title: `Invoice ${invoice.number} is overdue`, detail: `${invoice.party.name} owes ${money(invoice.balanceCents)}.` })),
        ...(ordersToShip > 0 ? [{ tone: "warn", title: "Orders waiting to ship", detail: `${ordersToShip} open.` }] : []),
      ],
    },
  };
}

function quoteLines(body: Record<string, unknown>) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  return lines.flatMap((line) => {
    if (!line || typeof line !== "object") return [];
    const row = line as Record<string, unknown>;
    const qty = Number(row.qty);
    if (!text(row, "productId") || !(qty > 0)) return [];
    return [{ productId: text(row, "productId"), qty, specialPrice: row.specialPrice == null || row.specialPrice === "" ? null : Number(row.specialPrice) }];
  });
}

async function createQuote(raw: unknown) {
  return writeQuote(undefined, asRecord(raw));
}

async function updateQuote(id: string, raw: unknown) {
  return writeQuote(id, asRecord(raw));
}

async function writeQuote(id: string | undefined, body: Record<string, unknown>) {
  const issued = parseDateInput(text(body, "issuedOn") || todayInput());
  const valid = parseDateInput(text(body, "validUntil"));
  if (!issued || !valid) return { status: 400, body: { error: "Enter issuedOn and validUntil as YYYY-MM-DD." } };
  const saved = await saveQuote(SPIKE_BOT, {
    id,
    partyId: text(body, "customerId"),
    issuedOn: issued,
    validUntil: valid,
    notes: text(body, "notes"),
    lines: quoteLines(body),
    terms: {
      incoterm: (text(body, "incoterm") || "EXW") as "EXW",
      namedPlace: text(body, "namedPlace") || "Clearwater plant",
      creditTerm: (text(body, "creditTerm") || "NET_30") as "NET_30",
    },
  });
  if (!saved.ok) return { status: 400, body: { error: saved.error } };
  return getQuote(saved.value.id);
}

async function getQuote(id: string) {
  const quote = await prisma.quote.findUnique({ where: { id }, include: { party: true, lines: true } });
  if (!quote) return { status: 404, body: { error: "Quote not found." } };
  return { status: 200, body: { quote: quoteJson(quote) } };
}

function quoteJson(quote: { id: string; number: string; revision: string; status: string; totalCents: number; party: { id: string; name: string; email: string }; lines: { productId: string; description: string; qty: { toString(): string }; unitPriceCents: number }[] }) {
  return {
    id: quote.id,
    number: quote.number,
    revision: quote.revision,
    status: quote.status,
    totalCents: quote.totalCents,
    total: money(quote.totalCents),
    customerId: quote.party.id,
    customer: quote.party.name,
    email: quote.party.email,
    lines: quote.lines.map((line) => ({ productId: line.productId, description: line.description, qty: Number(line.qty), unitPriceCents: line.unitPriceCents })),
  };
}

async function convertQuote(id: string) {
  const result = await acceptQuote(SPIKE_BOT, id);
  if (!result.ok) return { status: 400, body: { error: result.error } };
  const order = await prisma.salesOrder.findUnique({ where: { id: result.value.orderId }, include: { lines: true } });
  return { status: 200, body: { orderId: result.value.orderId, number: order?.number, lines: order?.lines.map((line) => ({ id: line.id, productId: line.productId, qty: Number(line.qty) })) } };
}

async function ship(id: string, raw: unknown) {
  const body = asRecord(raw);
  const shippedOn = parseDateInput(text(body, "shippedOn") || todayInput());
  if (!shippedOn) return { status: 400, body: { error: "shippedOn must be YYYY-MM-DD." } };
  const result = await shipOrder(SPIKE_BOT, {
    orderId: id,
    shipAll: body.shipAll === false ? false : true,
    shippedOn,
    carrier: text(body, "carrier"),
    tracking: text(body, "tracking"),
    notes: text(body, "notes"),
  });
  if (!result.ok) return { status: 400, body: { error: result.error } };
  return { status: 200, body: { deliveryId: result.value.deliveryId } };
}

async function invoiceOrder(id: string, raw: unknown) {
  const body = asRecord(raw);
  const issued = parseDateInput(text(body, "issuedOn") || todayInput());
  if (!issued) return { status: 400, body: { error: "issuedOn must be YYYY-MM-DD." } };
  const delivery = await prisma.delivery.findFirst({ where: { orderId: id, invoice: null }, orderBy: { shippedOn: "desc" } });
  if (!delivery) return { status: 400, body: { error: "Ship the order before creating the invoice." } };
  const result = await invoiceDelivery(SPIKE_BOT, delivery.id, issued);
  if (!result.ok) return { status: 400, body: { error: result.error } };
  return getInvoice(result.value.invoiceId);
}

async function getInvoice(id: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { party: true, lines: true } });
  if (!invoice) return { status: 404, body: { error: "Invoice not found." } };
  return {
    status: 200,
    body: {
      invoice: {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        channel: invoice.channel,
        customer: invoice.party.name,
        totalCents: invoice.totalCents,
        total: money(invoice.totalCents),
        balanceCents: invoice.balanceCents,
        balance: money(invoice.balanceCents),
        lines: invoice.lines.map((line) => ({ description: line.description, qty: Number(line.qty), unitPriceCents: line.unitPriceCents })),
      },
    },
  };
}

async function payment(raw: unknown) {
  const body = asRecord(raw);
  const paidOn = parseDateInput(text(body, "paidOn") || todayInput());
  if (!paidOn) return { status: 400, body: { error: "paidOn must be YYYY-MM-DD." } };
  const result = await payInvoice(SPIKE_BOT, {
    invoiceId: text(body, "invoiceId"),
    amountCents: Number(body.amountCents),
    paidOn,
    method: text(body, "method") || "Check",
    reference: text(body, "reference"),
  });
  if (!result.ok) return { status: 400, body: { error: result.error } };
  return { status: 200, body: { paymentId: result.value.paymentId } };
}

async function createPo(raw: unknown) {
  const body = asRecord(raw);
  const ordered = parseDateInput(text(body, "orderedOn") || todayInput());
  if (!ordered) return { status: 400, body: { error: "orderedOn must be YYYY-MM-DD." } };
  const lines = Array.isArray(body.lines) ? body.lines.flatMap((line) => {
    if (!line || typeof line !== "object") return [];
    const row = line as Record<string, unknown>;
    return [{ productId: text(row, "productId"), qty: Number(row.qty), unitPrice: Number(row.unitPrice) }];
  }) : [];
  const result = await savePurchaseOrder(SPIKE_BOT, {
    partyId: text(body, "supplierId"),
    orderedOn: ordered,
    expectedOn: text(body, "expectedOn") ? parseDateInput(text(body, "expectedOn")) : null,
    notes: text(body, "notes"),
    send: body.send !== false,
    lines,
  });
  if (!result.ok) return { status: 400, body: { error: result.error } };
  const order = await prisma.purchaseOrder.findUnique({ where: { id: result.value.id } });
  return { status: 200, body: { purchaseOrderId: result.value.id, number: order?.number, status: order?.status } };
}

async function releasePlan(raw: unknown) {
  const body = asRecord(raw);
  const weeks = Math.min(52, Math.max(1, Number(body.weeks) || 8));
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
  const emailTo = text(body, "email") || company?.trevorEmail || "";
  if (!emailTo) return { status: 400, body: { error: "Add Trevor's email in Settings, or pass email." } };
  const built = await buildSchedule(todayInput(), weeks);
  const released = await releaseSchedule(SPIKE_BOT, { asOf: built.asOf, windowWeeks: built.weeks, emailTo, lines: built.rows });
  if (!released.ok) return { status: 400, body: { error: released.error } };
  await emailSchedule(released.value.id, emailTo);
  return { status: 200, body: { id: released.value.id, number: released.value.number, emailedTo: emailTo, pdf: `/api/v1/work-lists/${released.value.id}/pdf` } };
}

async function quotePdf(id: string) {
  const quote = await prisma.quote.findUnique({ where: { id }, include: { party: true, lines: true } });
  if (!quote) return { status: 404, body: { error: "Quote not found." } };
  const html = documentHtml({
    title: "Quote",
    number: `${quote.number} rev ${quote.revision}`,
    party: quote.party.name,
    lines: quote.lines.map((line) => ({ description: line.description, qty: String(Number(line.qty)), amount: money(Math.round(Number(line.qty) * line.unitPriceCents)) })),
    total: money(quote.totalCents),
    note: "Example or live data follows the company banner. This PDF is what SPIKE would send.",
  });
  return pdfResult(html, `${quote.number}.pdf`);
}

async function invoicePdf(id: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { party: true, lines: true } });
  if (!invoice) return { status: 404, body: { error: "Invoice not found." } };
  const html = documentHtml({
    title: "Invoice",
    number: invoice.number,
    party: invoice.party.name,
    lines: invoice.lines.map((line) => ({ description: line.description, qty: String(Number(line.qty)), amount: money(Math.round(Number(line.qty) * line.unitPriceCents)) })),
    total: money(invoice.totalCents),
    note: `Balance ${money(invoice.balanceCents)}. Channel ${invoice.channel}.`,
  });
  return pdfResult(html, `${invoice.number}.pdf`);
}

async function poPdf(id: string) {
  const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: { party: true, lines: true } });
  if (!order) return { status: 404, body: { error: "Purchase order not found." } };
  const total = order.lines.reduce((sum, line) => sum + Math.round(Number(line.qty) * line.unitPriceCents), 0);
  const html = documentHtml({
    title: "Purchase order",
    number: order.number,
    party: order.party.name,
    lines: order.lines.map((line) => ({ description: line.description, qty: String(Number(line.qty)), amount: money(Math.round(Number(line.qty) * line.unitPriceCents)) })),
    total: money(total),
    note: order.notes || "Receive into quarantine before the material can be used.",
  });
  return pdfResult(html, `${order.number}.pdf`);
}

async function workListPdf(id: string) {
  const release = await prisma.scheduleRelease.findUnique({ where: { id }, include: { lines: true } });
  if (!release) return { status: 404, body: { error: "Work list not found." } };
  const plan = buildProductionPlan({
    number: release.number,
    weekOf: toDateInput(release.weekOf),
    releasedOn: toDateInput(release.createdAt),
    releasedBy: "SPIKE bot",
    lines: release.lines.map((line) => ({
      dueOn: toDateInput(line.dueOn),
      sku: line.sku,
      name: line.name,
      packageLabel: line.packageLabel,
      qty: Number(line.qty),
      fbaQty: Number(line.fbaQty),
      unit: line.unit,
      formulaVersion: line.formulaVersion,
      daysCover: line.daysCover == null ? null : Number(line.daysCover),
      shortage: line.shortage,
      materials: line.materials,
    })),
  });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${planDocumentHtml(plan, "")}</body></html>`;
  return pdfResult(html, `${release.number}.pdf`);
}

async function pdfResult(html: string, filename: string): Promise<SpikeResult> {
  const pdf = await htmlToPdf(html);
  return { status: 200, body: { filename }, pdf, filename };
}

async function draftMessage(raw: unknown) {
  const body = asRecord(raw);
  const kind = text(body, "kind");
  const id = text(body, "id");
  if (kind !== "quote" && kind !== "invoice") return { status: 400, body: { error: "kind must be quote or invoice." } };
  const loaded = kind === "quote"
    ? await prisma.quote.findUnique({ where: { id }, include: { party: true, lines: true } })
    : await prisma.invoice.findUnique({ where: { id }, include: { party: true, lines: true } });
  if (!loaded) return { status: 404, body: { error: "Document not found." } };
  const to = text(body, "to") || loaded.party.email;
  if (!to.includes("@")) return { status: 400, body: { error: "The customer needs an email address, or pass to." } };
  const number = "number" in loaded ? loaded.number : "";
  const total = money(loaded.totalCents);
  const subject = kind === "quote" ? `Quote ${number} from SPER Chemical` : `Invoice ${number} from SPER Chemical`;
  const message = kind === "quote"
    ? `Quote ${number} for ${loaded.party.name} totals ${total}. The PDF is attached. This is a draft until you confirm the send.`
    : `Invoice ${number} for ${loaded.party.name} totals ${total}. Balance ${money("balanceCents" in loaded ? loaded.balanceCents : loaded.totalCents)}. The PDF is attached. This is a draft until you confirm the send.`;
  const file = await (kind === "quote" ? quotePdf(id) : invoicePdf(id));
  if (!file.pdf) return { status: 500, body: { error: "The PDF could not be prepared." } };
  const draft = await prisma.outboundDraft.create({
    data: {
      kind,
      entityId: id,
      toAddress: to,
      subject,
      body: message,
      html: `<p>${message}</p>`,
      attachmentName: file.filename ?? `${number}.pdf`,
      pdf: Buffer.from(file.pdf),
      status: "DRAFT",
    },
  });
  return {
    status: 200,
    body: {
      draftId: draft.id,
      status: "DRAFT",
      to,
      subject,
      text: message,
      filename: draft.attachmentName,
      confirm: `/api/v1/messages/${draft.id}/confirm`,
    },
  };
}

async function getDraft(id: string) {
  const draft = await prisma.outboundDraft.findUnique({ where: { id } });
  if (!draft) return { status: 404, body: { error: "Draft not found." } };
  return { status: 200, body: { id: draft.id, status: draft.status, to: draft.toAddress, subject: draft.subject, text: draft.body, detail: draft.detail } };
}

async function confirmDraft(id: string) {
  const draft = await prisma.outboundDraft.findUnique({ where: { id } });
  if (!draft) return { status: 404, body: { error: "Draft not found." } };
  if (draft.status !== "DRAFT") return { status: 400, body: { error: `This draft is already ${draft.status}.` } };
  const setup = emailSetup();
  const sent = setup.configured
    ? await deliverEmail({
        from: setup.from,
        to: [draft.toAddress],
        subject: draft.subject,
        text: draft.body,
        html: draft.html,
        attachments: [{ filename: draft.attachmentName, contentType: "application/pdf", bytes: new Uint8Array(draft.pdf) }],
      })
    : { ok: false, detail: "Email is not configured. The draft was approved and logged, not sent." };
  const status = sent.ok ? "SENT" : "SKIPPED";
  await prisma.outboundDraft.update({ where: { id }, data: { status, detail: sent.detail } });
  await prisma.emailLog.create({ data: { toAddress: draft.toAddress, subject: draft.subject, body: draft.body, status, detail: sent.detail } });
  return { status: 200, body: { draftId: id, status, detail: sent.detail } };
}
