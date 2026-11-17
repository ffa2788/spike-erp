import { CHART, CODES } from "../chart";
import { rollUpCost } from "../costing";
import { parseDateInput } from "../dates";
import { prisma } from "../db";
import { contentsWeightLb, packagedCost, PACKAGE_PRESETS } from "../formula-math";
import { journalProblem } from "../journals";
import {
  dedupePayments,
  amazonFeeAccount,
  feeJournal,
  netMarginCents,
  parsePaymentsReport,
  readAmazonMoneyFile,
  paymentFingerprint,
  refundJournal,
  rollupPaymentFees,
  settlementJournal,
  storedPayment,
  transferJournal,
  type PaymentRow,
  type SkuFeeRollup,
} from "../amazon-payments";
import { suggestAmazonSku } from "../amazon-reports";
import { err, ok, type Result } from "../result";
import { nextNumber, postJournal, run, type Actor, type Tx } from "./shared";

export type PaymentsImportSummary = {
  rowsRead: number;
  created: number;
  duplicates: number;
  settled: string[];
  unsettledOrders: string[];
  transfers: number;
  transferCents: number;
  refunds: number;
  feeCents: number;
  reimbursements: number;
};

const FEE_TYPES = new Set(["shipping services", "service fee", "fba inventory fee", "fba transaction fees", "adjustment"]);
const REFUND_TYPES = new Set(["refund", "chargeback refund"]);

export async function importPaymentsFile(actor: Actor, text: string): Promise<Result<PaymentsImportSummary>> {
  const parsed = readAmazonMoneyFile(text);
  if (parsed.error) return err(parsed.error);
  const file = dedupePayments(parsed.rows);
  return run(async (tx) => {
    for (const account of CHART.filter((item) => item.code.startsWith("61"))) {
      await tx.account.upsert({
        where: { code: account.code },
        update: { name: account.name, type: account.type },
        create: { ...account, isExample: true },
      });
    }
    await tx.account.upsert({
      where: { code: CODES.amazonClearing },
      update: { name: "Due from Amazon", type: "ASSET" },
      create: { code: CODES.amazonClearing, name: "Due from Amazon", type: "ASSET", isExample: true },
    });
    const [existing, maps, products, amazon] = await Promise.all([
      tx.amazonSettlementLine.findMany({ select: { fingerprint: true } }),
      tx.amazonSkuMap.findMany(),
      tx.product.findMany({ where: { active: true } }),
      tx.party.findFirst({ where: { channel: "AMAZON", isCustomer: true } }),
    ]);
    const known = new Set(existing.map((row) => row.fingerprint));
    const mapBySku = new Map(maps.filter((row) => row.productId).map((row) => [row.amazonSku, row.productId!]));
    let duplicates = file.duplicates;
    const fresh: PaymentRow[] = [];
    for (const row of file.kept) {
      const fingerprint = paymentFingerprint(row);
      if (known.has(fingerprint)) {
        duplicates += 1;
        continue;
      }
      known.add(fingerprint);
      fresh.push(row);
      const suggestion = suggestAmazonSku({ sku: row.sku, asin: "", products });
      const productId = row.sku ? mapBySku.get(row.sku) ?? suggestion.productId : null;
      const stored = storedPayment(row);
      await tx.amazonSettlementLine.create({
        data: {
          fingerprint,
          postedAt: stored.dateTime,
          settlementId: stored.settlementId,
          type: stored.type,
          orderId: stored.orderId,
          sku: stored.sku,
          description: stored.description,
          qty: stored.qty,
          fulfillment: stored.fulfillment,
          productSalesCents: stored.productSalesCents,
          sellingFeeCents: stored.sellingFeeCents,
          fbaFeeCents: stored.fbaFeeCents,
          otherTransactionFeeCents: stored.otherTransactionFeeCents,
          otherCents: stored.otherCents,
          promotionalRebatesCents: stored.promotionalRebatesCents,
          totalCents: stored.totalCents,
          productId,
          isExample: true,
        },
      });
    }
    const settled: string[] = [];
    const unsettledOrders: string[] = [];
    const orders = new Map<string, PaymentRow[]>();
    for (const row of fresh) {
      if (row.type.trim().toLowerCase() !== "order" || !row.orderId) continue;
      const list = orders.get(row.orderId) ?? [];
      list.push(row);
      orders.set(row.orderId, list);
    }
    for (const [orderId, lines] of orders) {
      const posted = await settleOrder(tx, actor, amazon?.id ?? null, orderId, lines);
      if (!posted.ok) return posted;
      if (posted.value.number) settled.push(posted.value.number);
      else unsettledOrders.push(orderId);
    }
    let transfers = 0;
    let transferCents = 0;
    let refunds = 0;
    let feeCents = 0;
    let reimbursements = 0;
    for (const row of fresh) {
      const type = row.type.trim().toLowerCase();
      if (type === "order" || type === "transfer") continue;
      const feeMemo = type === "shipping services" && row.orderId ? `Amazon shipping label ${row.orderId}` : `Amazon ${row.type}`;
      const journalLines = REFUND_TYPES.has(type)
        ? refundJournal(row)
        : FEE_TYPES.has(type)
          ? feeJournal(row.totalCents || rowEffect(row), amazonFeeAccount(row.type, row.description), feeMemo)
          : null;
      if (!journalLines) continue;
      if (REFUND_TYPES.has(type)) refunds += 1;
      else if (type === "adjustment" && (row.totalCents || rowEffect(row)) > 0) reimbursements += 1;
      else feeCents += Math.abs(row.totalCents || rowEffect(row));
      const problem = journalProblem(journalLines);
      if (problem) return err(problem);
      const journal = await postJournal(tx, actor, {
        date: parseDateInput(row.day) ?? new Date(),
        memo: `Amazon ${row.type}${row.orderId ? ` ${row.orderId}` : ""}`,
        source: REFUND_TYPES.has(type) ? "AMAZON_REFUND" : "AMAZON_FEE",
        lines: journalLines,
        isExample: true,
      });
      if (!journal.ok) return journal;
      await tx.amazonSettlementLine.updateMany({
        where: { fingerprint: paymentFingerprint(row) },
        data: { journalId: journal.value },
      });
    }
    for (const row of fresh) {
      if (row.type.trim().toLowerCase() !== "transfer") continue;
      const journalLines = transferJournal(row.totalCents);
      if (!journalLines) continue;
      const journal = await postJournal(tx, actor, {
        date: parseDateInput(row.day) ?? new Date(),
        memo: `Amazon payout ${row.settlementId || row.dateTime}`,
        source: "AMAZON_TRANSFER",
        sourceId: row.settlementId,
        lines: journalLines,
        isExample: true,
      });
      if (!journal.ok) return journal;
      await tx.amazonSettlementLine.updateMany({
        where: { fingerprint: paymentFingerprint(row) },
        data: { journalId: journal.value },
      });
      transfers += 1;
      transferCents += -row.totalCents;
    }
    return ok({
      rowsRead: parsed.rows.length,
      created: fresh.length,
      duplicates,
      settled,
      unsettledOrders,
      transfers,
      transferCents,
      refunds,
      feeCents,
      reimbursements,
    });
  });
}

function rowEffect(row: PaymentRow): number {
  if (row.totalCents !== 0) return row.totalCents;
  return row.sellingFeeCents + row.fbaFeeCents + row.otherTransactionFeeCents + row.otherCents + row.promotionalRebatesCents + row.productSalesCents;
}

async function settleOrder(
  tx: Tx,
  actor: Actor,
  partyId: string | null,
  orderId: string,
  lines: PaymentRow[],
): Promise<Result<{ number: string }>> {
  const orderTotalCents = lines.reduce((sum, row) => sum + row.totalCents, 0);
  const invoice = await tx.invoice.findFirst({
    where: { channel: "AMAZON", marketplaceOrderId: orderId, status: { not: "VOID" } },
  });
  if (!invoice || invoice.balanceCents <= 0 || !partyId) {
    return ok({ number: "" });
  }
  const journalLines = settlementJournal({ invoiceBalanceCents: invoice.balanceCents, orderTotalCents });
  if (!journalLines) return ok({ number: "" });
  const problem = journalProblem(journalLines);
  if (problem) return err(problem);
  const paidOn = parseDateInput(lines[0]?.day ?? "") ?? invoice.issuedOn;
  const clearing = Math.max(0, orderTotalCents);
  const payment = await tx.customerPayment.create({
    data: {
      number: await nextNumber(tx, "receipt-pay"),
      partyId,
      paidOn,
      amountCents: clearing,
      method: "Amazon settlement",
      reference: orderId,
      notes: `Settled from the payments report against ${invoice.number}.`,
      isExample: true,
      applications: { create: { invoiceId: invoice.id, amountCents: invoice.balanceCents } },
    },
  });
  const journal = await postJournal(tx, actor, {
    date: paidOn,
    memo: `Amazon settlement ${payment.number} on ${invoice.number}`,
    source: "CUSTOMER_PAYMENT",
    sourceId: payment.id,
    lines: journalLines,
    isExample: true,
  });
  if (!journal.ok) return journal;
  await tx.customerPayment.update({ where: { id: payment.id }, data: { journalId: journal.value } });
  await tx.invoice.update({
    where: { id: invoice.id },
    data: { balanceCents: 0, status: "PAID" },
  });
  await tx.amazonSettlementLine.updateMany({
    where: { fingerprint: { in: lines.map(paymentFingerprint) } },
    data: { journalId: journal.value },
  });
  return ok({ number: invoice.number });
}

export type MarginRow = SkuFeeRollup & {
  productSku: string;
  productName: string;
  unitCostCents: number | null;
  costCents: number | null;
  marginCents: number | null;
};

export async function amazonMarginView(): Promise<{ margins: MarginRow[]; payoutCents: number; lineCount: number }> {
  const [lines, maps, products, formulas, packages] = await Promise.all([
    prisma.amazonSettlementLine.findMany(),
    prisma.amazonSkuMap.findMany({ include: { product: true } }),
    prisma.product.findMany(),
    prisma.formula.findMany({ where: { isDefault: true }, include: { lines: true } }),
    prisma.packagedSku.findMany({ include: { lines: { include: { material: true } }, product: true } }),
  ]);
  const rows: PaymentRow[] = lines.map((line) => ({
    dateTime: line.postedAt,
    day: "",
    settlementId: line.settlementId,
    type: line.type,
    orderId: line.orderId,
    sku: line.sku,
    description: line.description,
    qty: Number(line.qty),
    fulfillment: line.fulfillment,
    channel: line.fulfillment.toLowerCase() === "amazon" ? "FBA" : line.fulfillment.toLowerCase() === "merchant" ? "FBM" : "",
    productSalesCents: line.productSalesCents,
    sellingFeeCents: line.sellingFeeCents,
    fbaFeeCents: line.fbaFeeCents,
    otherTransactionFeeCents: line.otherTransactionFeeCents,
    otherCents: line.otherCents,
    promotionalRebatesCents: line.promotionalRebatesCents,
    totalCents: line.totalCents,
  }));
  const rollups = rollupPaymentFees(rows);
  const mapBySku = new Map(maps.map((row) => [row.amazonSku, row]));
  const costByProduct = new Map<string, number | null>();
  const unitCost = (productId: string) => {
    if (costByProduct.has(productId)) return costByProduct.get(productId) ?? null;
    const cost = packagedUnitCostCents(productId, products, formulas, packages);
    costByProduct.set(productId, cost);
    return cost;
  };
  const margins = rollups.map((rollup) => {
    const mapped = mapBySku.get(rollup.sku);
    const suggestion = suggestAmazonSku({
      sku: rollup.sku,
      asin: mapped?.asin ?? "",
      products: products.map((product) => ({ id: product.id, sku: product.sku, name: product.name })),
    });
    const productId = mapped?.productId ?? suggestion.productId;
    const product = products.find((item) => item.id === productId);
    const unit = productId ? unitCost(productId) : null;
    const margin = netMarginCents(rollup, unit);
    return {
      ...rollup,
      productSku: product?.sku ?? "",
      productName: product?.name ?? suggestion.label,
      unitCostCents: unit,
      costCents: margin.costCents,
      marginCents: margin.marginCents,
    };
  });
  const payoutCents = lines
    .filter((line) => line.type.trim().toLowerCase() === "transfer")
    .reduce((sum, line) => sum - line.totalCents, 0);
  return { margins, payoutCents, lineCount: lines.length };
}

function packagedUnitCostCents(
  productId: string,
  products: { id: string; sku: string; name: string; kind: string; standardCost: { toString(): string }; specificGravity: { toString(): string } | null; form: string }[],
  formulas: { productId: string; isDefault: boolean; specificGravity: { toString(): string } | null; lines: { ingredientId: string; percent: { toString(): string } }[] }[],
  packages: {
    outputProductId: string;
    productId: string;
    packageCode: string;
    unitsPerCase: number;
    casesPerPallet: number;
    product: { specificGravity: { toString(): string } | null; form: string };
    lines: { basis: string; qty: { toString(): string }; material: { name: string; standardCost: { toString(): string } } }[];
  }[],
): number | null {
  const pack = packages.find((item) => item.outputProductId === productId);
  if (!pack) return null;
  const rolled = rollUpCost(
    pack.productId,
    products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      kind: product.kind as "RAW" | "FINISHED" | "UTILITY" | "PACKAGING",
      standardCost: Number(product.standardCost),
    })),
    formulas.map((formula) => ({
      productId: formula.productId,
      isDefault: formula.isDefault,
      lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
    })),
  );
  const preset = PACKAGE_PRESETS.find((item) => item.code === pack.packageCode);
  const gravity = formulas.find((formula) => formula.productId === pack.productId)?.specificGravity;
  const contentsLb = contentsWeightLb({
    form: pack.product.form === "POWDER" ? "POWDER" : "LIQUID",
    gallons: preset?.gallons,
    netLb: preset?.netLb,
    specificGravity: gravity != null ? Number(gravity) : pack.product.specificGravity != null ? Number(pack.product.specificGravity) : null,
  });
  const cost = packagedCost({
    contentsCostPerLb: rolled.costPerUnit,
    contentsLb: contentsLb ?? 0,
    gallons: preset?.gallons ?? null,
    unitsPerCase: pack.unitsPerCase,
    casesPerPallet: pack.casesPerPallet,
    laborPerUnit: 0,
    packaging: pack.lines.map((line) => ({
      name: line.material.name,
      basis: line.basis as "UNIT" | "CASE" | "PALLET",
      qty: Number(line.qty),
      unitCost: Number(line.material.standardCost) > 0 ? Number(line.material.standardCost) : null,
    })),
  });
  if (!cost.ok) return null;
  return Math.round((cost.cost.contentsCost + cost.cost.packagingCost) * 100);
}
