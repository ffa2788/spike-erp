import { documentHtml, money } from "../spike-documents";
import { htmlToPdf } from "../html-to-pdf";
import { stockBuckets } from "../inventory";
import { prisma } from "../db";
import { toDateInput, todayInput } from "../dates";
import { err, ok, type Result } from "../result";
import { currentStock } from "../read-models";
import { packGoods } from "./pack";
import type { Actor } from "./shared";

export async function storeAmazonInvoicePdf(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { party: true, lines: true } });
  if (!invoice || invoice.channel !== "AMAZON") return;
  const html = documentHtml({
    title: "Invoice",
    number: invoice.number,
    party: "Amazon Customer",
    lines: invoice.lines.map((line) => ({
      description: line.description,
      qty: String(Number(line.qty)),
      amount: money(Math.round(Number(line.qty) * line.unitPriceCents)),
    })),
    total: money(invoice.totalCents),
    note: invoice.fulfillment === "FBM" ? "Fulfilled by SPER (FBM)." : "Fulfilled by Amazon (FBA).",
  });
  const pdf = await htmlToPdf(html);
  await prisma.amazonInvoiceFile.upsert({
    where: { invoiceId },
    update: { pdf: Buffer.from(pdf), filename: `${invoice.number}.pdf`, period: toDateInput(invoice.issuedOn).slice(0, 7) },
    create: { invoiceId, pdf: Buffer.from(pdf), filename: `${invoice.number}.pdf`, period: toDateInput(invoice.issuedOn).slice(0, 7) },
  });
}

/** If the supermarket is short of a finished package, pack it from the bulk recipe and the packaging BOM. */
export async function assembleForAmazonOrders(actor: Actor, packedOn = new Date()): Promise<Result<{ posted: { sku: string; units: number }[]; skipped: string[] }>> {
  const items = await prisma.amazonOrderItem.findMany({
    where: { shipped: true, cancelled: false, fulfillment: "FBM", productId: { not: null } },
  });
  const need = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) continue;
    need.set(item.productId, (need.get(item.productId) ?? 0) + Number(item.qty));
  }
  const today = toDateInput(packedOn);
  const stock = await currentStock();
  const posted: { sku: string; units: number }[] = [];
  const skipped: string[] = [];
  for (const [productId, qty] of need) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) continue;
    const onHand = stockBuckets(stock, productId, today).available;
    const short = Math.ceil(qty - onHand);
    if (short <= 0) continue;
    const pack = await prisma.packagedSku.findFirst({ where: { outputProductId: productId } });
    if (!pack) {
      skipped.push(`${product.sku} is short ${short} and has no packaging recipe.`);
      continue;
    }
    const made = await packGoods(actor, { packagedSkuId: pack.id, units: short, packedOn });
    if (!made.ok) {
      skipped.push(`${product.sku}: ${made.error}`);
      continue;
    }
    await prisma.amazonAssembly.create({
      data: { packedOn, productId, sku: product.sku, units: short, runId: made.value.runId },
    });
    posted.push({ sku: product.sku, units: short });
  }
  return ok({ posted, skipped });
}

export async function confirmAssemblies(actor: Actor): Promise<Result<{ confirmed: number }>> {
  const open = await prisma.amazonAssembly.findMany({ where: { confirmedAt: null } });
  await prisma.amazonAssembly.updateMany({ where: { confirmedAt: null }, data: { confirmedAt: new Date() } });
  await prisma.auditLog.create({
    data: { userId: actor.id, userName: actor.name, action: "confirm", entity: "AmazonAssembly", entityId: "week", summary: `Chris confirmed ${open.length} Amazon assemblies.` },
  });
  return ok({ confirmed: open.length });
}

export async function matchAmazonDeposit(actor: Actor, input: { statementLineId: string; settlementId: string }): Promise<Result<{ cents: number }>> {
  const { deny, run } = await import("./shared");
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const line = await tx.statementLine.findUnique({ where: { id: input.statementLineId } });
    if (!line) return err("That bank line was not found. Import the Truist CSV first.");
    if (line.reconciled) return err("That bank line is already reconciled.");
    const entry = await tx.journalEntry.findFirst({
      where: { source: "AMAZON_TRANSFER", sourceId: input.settlementId },
      include: { lines: { include: { account: true } } },
    });
    if (!entry) return err(`No Amazon deposit is posted for settlement ${input.settlementId}. Import the payments report first.`);
    const cash = entry.lines.find((item) => item.account.code === "1000");
    const cents = cash ? cash.debitCents - cash.creditCents : 0;
    if (cents !== line.amountCents) {
      return err(`The Truist line is ${(line.amountCents / 100).toFixed(2)} and settlement ${input.settlementId} is ${(cents / 100).toFixed(2)}. They have to match to the penny.`);
    }
    await tx.statementLine.update({
      where: { id: line.id },
      data: { reconciled: true, matchedKind: "AMAZON", matchedId: input.settlementId, matchedJournalId: entry.id },
    });
    const { audit } = await import("./shared");
    await audit(tx, actor, "reconcile", "StatementLine", line.id, `Matched Truist ${cents} cents to Amazon settlement ${input.settlementId}.`);
    return ok({ cents });
  });
}

export async function amazonFeesByMonth() {
  const lines = await prisma.journalLine.findMany({
    where: { account: { code: { startsWith: "61" } }, entry: { source: { in: ["AMAZON_FEE", "AMAZON_REFUND"] } } },
    include: { account: true, entry: true },
  });
  const groups = new Map<string, { month: string; account: string; name: string; cents: number }>();
  for (const line of lines) {
    const month = toDateInput(line.entry.date).slice(0, 7);
    const key = `${month}|${line.account.code}`;
    const current = groups.get(key) ?? { month, account: line.account.code, name: line.account.name, cents: 0 };
    current.cents += line.debitCents - line.creditCents;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.account.localeCompare(b.account));
}

export async function amazonWeek(asOf = todayInput()) {
  const start = `${asOf.slice(0, 7)}-01`;
  const [orders, invoices, assemblies, deposits, unmapped, fees] = await Promise.all([
    prisma.amazonOrderItem.count({ where: { purchaseDate: { gte: new Date(`${start}T00:00:00Z`) }, cancelled: false } }),
    prisma.invoice.findMany({ where: { channel: "AMAZON", issuedOn: { gte: new Date(`${start}T00:00:00Z`) }, status: { not: "VOID" } }, select: { id: true, number: true, fulfillment: true, totalCents: true } }),
    prisma.amazonAssembly.findMany({ orderBy: { packedOn: "desc" }, take: 20 }),
    prisma.journalEntry.findMany({ where: { source: "AMAZON_TRANSFER" }, include: { lines: { include: { account: true } } }, orderBy: { date: "desc" }, take: 8 }),
    prisma.amazonOrderItem.findMany({ where: { productId: null, cancelled: false, shipped: true }, select: { sku: true, amazonOrderId: true } }),
    amazonFeesByMonth(),
  ]);
  const files = await prisma.amazonInvoiceFile.count({ where: { period: asOf.slice(0, 7) } });
  return {
    month: asOf.slice(0, 7),
    orders,
    invoices: invoices.length,
    invoiceNumbers: invoices.map((invoice) => invoice.number),
    fba: invoices.filter((invoice) => invoice.fulfillment === "FBA").length,
    fbm: invoices.filter((invoice) => invoice.fulfillment === "FBM").length,
    pdfs: files,
    assemblies,
    deposits: deposits.map((entry) => {
      const cash = entry.lines.find((line) => line.account.code === "1000");
      return { settlementId: entry.sourceId, cents: cash ? cash.debitCents - cash.creditCents : 0, memo: entry.memo };
    }),
    unmapped: [...new Map(unmapped.map((row) => [row.sku, row])).values()],
    fees,
  };
}

export async function invoiceZip(period: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const files = await prisma.amazonInvoiceFile.findMany({ where: { period } });
  if (files.length === 0) return null;
  const bytes = zipStored(files.map((file) => ({ name: file.filename, data: new Uint8Array(file.pdf) })));
  return { filename: `amazon-invoices-${period}.zip`, bytes };
}

function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 0, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    chunks.push(local);
    const dir = new Uint8Array(46 + name.length);
    const dirView = new DataView(dir.buffer);
    dirView.setUint32(0, 0x02014b50, true);
    dirView.setUint32(20, file.data.length, true);
    dirView.setUint32(24, file.data.length, true);
    dirView.setUint16(28, name.length, true);
    dirView.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += local.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...chunks, ...central, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

