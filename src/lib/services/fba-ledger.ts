import { CODES, inventoryAccount } from "../chart";
import { parseDateInput } from "../dates";
import { valueCents } from "../inventory";
import { spreadFreight } from "../fba-landed";
import { err, ok, type Result } from "../result";
import { audit, deny, loadBalances, locationByCode, nextNumber, postJournal, run, type Actor, type Tx } from "./shared";

type ShipLine = { lotId: string; qty: number; weightLb?: number };

export async function shipToFba(
  actor: Actor,
  input: { shipmentId: string; shippedOn: Date; freightCents?: number; spreadBy?: "UNITS" | "WEIGHT"; lines: ShipLine[] },
): Promise<Result<{ id: string; shipmentId: string }>> {
  const denied = deny(actor, "ship");
  if (denied) return denied;
  const shipmentId = input.shipmentId.trim();
  if (!shipmentId) return err("Enter the Amazon FBA shipment id.");
  if (input.lines.length === 0) return err("Choose a lot and a quantity to send.");
  return run(async (tx) => {
    const existing = await tx.fbaShipment.findUnique({ where: { shipmentId } });
    if (existing) return err(`FBA shipment ${shipmentId} is already on file.`);
    const main = await locationByCode(tx, "MAIN");
    const amazon = await locationByCode(tx, "AMAZON");
    const freightCents = Math.max(0, Math.round(input.freightCents ?? 0));
    const spreadBy = input.spreadBy ?? (input.lines.some((line) => (line.weightLb ?? 0) > 0) ? "WEIGHT" : "UNITS");
    const shares = spreadFreight(
      input.lines.map((line) => ({ key: line.lotId, qty: line.qty, weight: line.weightLb ?? 0 })),
      freightCents,
      spreadBy,
    );
    const prepared: {
      lotId: string;
      productId: string;
      qty: number;
      weightLb: number;
      landedUnitCost: number;
      account: string;
      fbaLotNumber: string;
    }[] = [];
    for (const line of input.lines) {
      if (!(line.qty > 0)) return err("Each line needs a quantity.");
      const lot = await tx.lot.findUnique({ where: { id: line.lotId }, include: { product: true } });
      if (!lot) return err("That lot was not found.");
      if (lot.qcStatus !== "APPROVED") return err(`${lot.lotNumber} is not released, so it cannot go to Amazon.`);
      const balances = await loadBalances(tx, [lot.productId]);
      const onHand = balances.find((item) => item.lotId === lot.id)?.locations.find((place) => place.locationId === main.id);
      if (!onHand || onHand.qty + 0.0001 < line.qty) return err(`${lot.lotNumber} does not have ${line.qty} in Clearwater.`);
      const account = inventoryAccount(lot.product.kind);
      if (!account) return err(`${lot.product.name} is not stored in inventory.`);
      const freight = shares.get(line.lotId) ?? 0;
      const landedCents = valueCents(line.qty, Number(lot.unitCost)) + freight;
      prepared.push({
        lotId: lot.id,
        productId: lot.productId,
        qty: line.qty,
        weightLb: line.weightLb ?? 0,
        landedUnitCost: landedCents / 100 / line.qty,
        account,
        fbaLotNumber: `${lot.lotNumber}-FBA-${shipmentId}`.slice(0, 40),
      });
    }
    let journalId: string | null = null;
    if (freightCents > 0) {
      const byAccount = new Map<string, number>();
      for (const line of prepared) {
        const freight = shares.get(line.lotId) ?? 0;
        byAccount.set(line.account, (byAccount.get(line.account) ?? 0) + freight);
      }
      const lines = [...byAccount.entries()].filter(([, cents]) => cents > 0).map(([accountCode, cents]) => ({
        accountCode,
        debitCents: cents,
        creditCents: 0,
        memo: `FBA inbound freight ${shipmentId}`,
      }));
      lines.push({ accountCode: CODES.cash, debitCents: 0, creditCents: freightCents, memo: `FBA inbound freight ${shipmentId}` });
      const journal = await postJournal(tx, actor, {
        date: input.shippedOn,
        memo: `FBA freight ${shipmentId}`,
        source: "FBA_FREIGHT",
        sourceId: shipmentId,
        lines,
        isExample: true,
      });
      if (!journal.ok) return journal;
      journalId = journal.value;
    }
    const shipment = await tx.fbaShipment.create({
      data: {
        shipmentId,
        shippedOn: input.shippedOn,
        freightCents,
        spreadBy,
        status: "IN_TRANSIT",
        journalId,
      },
    });
    for (const line of prepared) {
      const source = await tx.lot.findUniqueOrThrow({ where: { id: line.lotId } });
      const fbaLot = await tx.lot.create({
        data: {
          lotNumber: line.fbaLotNumber,
          productId: line.productId,
          qcStatus: "APPROVED",
          unitCost: line.landedUnitCost,
          receivedOn: input.shippedOn,
          origin: "FBA",
          notes: `Landed cost for FBA shipment ${shipmentId}.`,
          isExample: source.isExample,
        },
      });
      await tx.movement.create({
        data: {
          at: input.shippedOn,
          lotId: source.id,
          productId: line.productId,
          locationId: main.id,
          qty: -line.qty,
          reason: "FBA_SHIP",
          refType: "FbaShipment",
          refId: shipment.id,
          note: shipmentId,
        },
      });
      await tx.movement.create({
        data: {
          at: input.shippedOn,
          lotId: fbaLot.id,
          productId: line.productId,
          locationId: amazon.id,
          qty: line.qty,
          reason: "FBA_SHIP",
          refType: "FbaShipment",
          refId: shipment.id,
          note: shipmentId,
        },
      });
      await tx.fbaShipmentLine.create({
        data: {
          shipmentId: shipment.id,
          productId: line.productId,
          sourceLotId: source.id,
          fbaLotId: fbaLot.id,
          qtyShipped: line.qty,
          weightLb: line.weightLb,
          landedUnitCost: line.landedUnitCost,
        },
      });
    }
    await audit(tx, actor, "ship", "FbaShipment", shipment.id, `Shipped ${shipmentId} to Amazon FBA. No sale was recorded.`);
    return ok({ id: shipment.id, shipmentId });
  });
}

export async function receiveFbaShipment(
  actor: Actor,
  input: { shipmentId: string; receivedOn: Date; lines: { productId: string; qtyReceived: number }[] },
): Promise<Result<{ claims: { productId: string; qty: number; costCents: number }[] }>> {
  const denied = deny(actor, "receive");
  if (denied) return denied;
  return run(async (tx) => {
    const shipment = await tx.fbaShipment.findUnique({ where: { shipmentId: input.shipmentId }, include: { lines: true } });
    if (!shipment) return err("That FBA shipment was not found.");
    const amazon = await locationByCode(tx, "AMAZON");
    const claims: { productId: string; qty: number; costCents: number }[] = [];
    for (const line of shipment.lines) {
      const received = input.lines.find((item) => item.productId === line.productId);
      const qtyReceived = received ? received.qtyReceived : Number(line.qtyShipped);
      if (qtyReceived < 0 || qtyReceived - Number(line.qtyShipped) > 0.0001) return err("Amazon cannot receive more than was shipped.");
      const short = Math.round((Number(line.qtyShipped) - qtyReceived) * 10000) / 10000;
      await tx.fbaShipmentLine.update({
        where: { id: line.id },
        data: { qtyReceived, claimQty: short },
      });
      if (short > 0) {
        const costCents = valueCents(short, Number(line.landedUnitCost));
        await tx.movement.create({
          data: {
            at: input.receivedOn,
            lotId: line.fbaLotId,
            productId: line.productId,
            locationId: amazon.id,
            qty: -short,
            reason: "FBA_CLAIM",
            refType: "FbaShipment",
            refId: shipment.id,
            note: `${input.shipmentId} short ${short}`,
          },
        });
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
        const account = inventoryAccount(product.kind);
        if (!account) return err("This item is not stored in inventory.");
        const journal = await postJournal(tx, actor, {
          date: input.receivedOn,
          memo: `FBA claim ${input.shipmentId}`,
          source: "FBA_CLAIM",
          sourceId: shipment.id,
          lines: [
            { accountCode: CODES.amazonClearing, debitCents: costCents, creditCents: 0, memo: "Due from Amazon for units they did not receive" },
            { accountCode: account, debitCents: 0, creditCents: costCents, memo: "FBA units missing on receipt" },
          ],
          isExample: true,
        });
        if (!journal.ok) return journal;
        claims.push({ productId: line.productId, qty: short, costCents });
      }
    }
    await tx.fbaShipment.update({ where: { id: shipment.id }, data: { status: "RECEIVED" } });
    await audit(tx, actor, "receive", "FbaShipment", shipment.id, `Amazon received ${input.shipmentId}. ${claims.length ? `${claims.length} shortfall claim.` : "No shortfall."}`);
    return ok({ claims });
  });
}

async function takeFromFba(tx: Tx, productId: string, qty: number, at: Date, reason: string, refId: string) {
  const amazon = await locationByCode(tx, "AMAZON");
  const balances = await loadBalances(tx, [productId]);
  let left = qty;
  const taken: { lotId: string; qty: number; costCents: number }[] = [];
  const lots = balances
    .filter((lot) => lot.productId === productId)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
  for (const lot of lots) {
    const place = lot.locations.find((item) => item.locationId === amazon.id);
    if (!place || place.qty <= 0 || left <= 0) continue;
    const take = Math.min(place.qty, left);
    const before = place.qty;
    const costCents = valueCents(before, lot.unitCost) - valueCents(before - take, lot.unitCost);
    await tx.movement.create({
      data: {
        at,
        lotId: lot.lotId,
        productId,
        locationId: amazon.id,
        qty: -take,
        reason,
        refType: "Fba",
        refId,
        note: reason,
      },
    });
    taken.push({ lotId: lot.lotId, qty: take, costCents });
    left = Math.round((left - take) * 10000) / 10000;
  }
  if (left > 0.0001) return err("Amazon FBA does not have that many units on hand.");
  return ok(taken);
}

export async function sellFromFba(
  actor: Actor,
  input: { orderId: string; productId: string; qty: number; unitPriceCents: number; feeCents: number; soldOn: Date },
): Promise<Result<{ invoiceId: string; number: string; cogsCents: number }>> {
  const denied = deny(actor, "importData");
  if (denied) return denied;
  if (!(input.qty > 0) || !Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0) return err("Enter a quantity and a whole-cent price.");
  if (!Number.isInteger(input.feeCents) || input.feeCents < 0) return err("Fees must be whole cents.");
  return run(async (tx) => postFbaSaleTx(tx, actor, input));
}

async function postFbaSaleTx(
  tx: Tx,
  actor: Actor,
  input: { orderId: string; productId: string; qty: number; unitPriceCents: number; feeCents: number; soldOn: Date },
): Promise<Result<{ invoiceId: string; number: string; cogsCents: number }>> {
  const existing = await tx.invoice.findFirst({ where: { channel: "AMAZON", marketplaceOrderId: input.orderId, status: { not: "VOID" } } });
  if (existing) return ok({ invoiceId: existing.id, number: existing.number, cogsCents: 0 });
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  const party = await tx.party.findFirst({ where: { channel: "AMAZON", isCustomer: true } });
  if (!product || !party) return err("The Amazon customer or the product is missing.");
  const account = inventoryAccount(product.kind);
  if (!account) return err(`${product.name} is not stored in inventory.`);
  const taken = await takeFromFba(tx, product.id, input.qty, input.soldOn, "FBA_SALE", input.orderId);
  if (!taken.ok) return taken;
  const cogsCents = taken.value.reduce((sum, line) => sum + line.costCents, 0);
  const salesCents = input.unitPriceCents * input.qty;
  const invoice = await tx.invoice.create({
    data: {
      number: await nextNumber(tx, "invoice-A"),
      partyId: party.id,
      issuedOn: input.soldOn,
      dueOn: input.soldOn,
      status: "OPEN",
      subtotalCents: salesCents,
      taxCents: 0,
      totalCents: salesCents,
      balanceCents: salesCents,
      goodsNetCents: salesCents,
      feeCents: input.feeCents,
      channel: "AMAZON",
      fulfillment: "FBA",
      marketplaceOrderId: input.orderId,
      currency: "USD",
      notes: `FBA sale ${product.sku}. Due from Amazon.`,
      isExample: true,
      lines: { create: [{ productId: product.id, description: product.name, qty: input.qty, unitPriceCents: input.unitPriceCents, taxable: false }] },
    },
  });
  const sale = await postJournal(tx, actor, {
    date: input.soldOn,
    memo: `FBA sale ${product.sku} ${invoice.number}`,
    source: "FBA_SALE",
    sourceId: invoice.id,
    lines: [
      { accountCode: CODES.amazonClearing, debitCents: salesCents, creditCents: 0, memo: "Due from Amazon" },
      { accountCode: CODES.sales, debitCents: 0, creditCents: salesCents, memo: `FBA sale ${product.sku}` },
    ],
    isExample: true,
  });
  if (!sale.ok) return sale;
  const cogs = await postJournal(tx, actor, {
    date: input.soldOn,
    memo: `FBA cogs ${product.sku} ${invoice.number}`,
    source: "FBA_COGS",
    sourceId: invoice.id,
    lines: [
      { accountCode: CODES.cogs, debitCents: cogsCents, creditCents: 0, memo: `FBA cogs ${product.sku}` },
      { accountCode: account, debitCents: 0, creditCents: cogsCents, memo: `FBA cogs ${product.sku}` },
    ],
    isExample: true,
  });
  if (!cogs.ok) return cogs;
  if (input.feeCents > 0) {
    const fee = await postJournal(tx, actor, {
      date: input.soldOn,
      memo: `FBA fee ${product.sku} ${invoice.number}`,
      source: "FBA_FEE",
      sourceId: invoice.id,
      lines: [
        { accountCode: CODES.amazonFees, debitCents: input.feeCents, creditCents: 0, memo: `FBA fee ${product.sku}` },
        { accountCode: CODES.amazonClearing, debitCents: 0, creditCents: input.feeCents, memo: "Amazon kept the fee" },
      ],
      isExample: true,
    });
    if (!fee.ok) return fee;
  }
  await tx.invoice.update({ where: { id: invoice.id }, data: { salesJournalId: sale.value, cogsJournalId: cogs.value } });
  return ok({ invoiceId: invoice.id, number: invoice.number, cogsCents });
}

export async function returnToFba(
  actor: Actor,
  input: { productId: string; qty: number; sellable: boolean; unitPriceCents: number; returnedOn: Date },
): Promise<Result<{ qty: number }>> {
  const denied = deny(actor, "importData");
  if (denied) return denied;
  return run(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) return err("That product was not found.");
    const account = inventoryAccount(product.kind);
    if (!account) return err("This item is not stored in inventory.");
    const salesCents = input.unitPriceCents * input.qty;
    const refund = await postJournal(tx, actor, {
      date: input.returnedOn,
      memo: `FBA return ${product.sku}`,
      source: "FBA_RETURN",
      lines: [
        { accountCode: CODES.sales, debitCents: salesCents, creditCents: 0, memo: `FBA return revenue ${product.sku}` },
        { accountCode: CODES.amazonClearing, debitCents: 0, creditCents: salesCents, memo: "Amazon refunded the buyer" },
      ],
      isExample: true,
    });
    if (!refund.ok) return refund;
    if (input.sellable) {
      const amazon = await locationByCode(tx, "AMAZON");
      const lot = await tx.lot.findFirst({ where: { productId: product.id, origin: "FBA", qcStatus: "APPROVED" }, orderBy: { receivedOn: "desc" } });
      if (!lot) return err("There is no FBA lot to put the return back on.");
      const costCents = valueCents(input.qty, Number(lot.unitCost));
      await tx.movement.create({
        data: {
          at: input.returnedOn,
          lotId: lot.id,
          productId: product.id,
          locationId: amazon.id,
          qty: input.qty,
          reason: "FBA_RETURN",
          refType: "Fba",
          refId: lot.id,
          note: "Sellable return",
        },
      });
      const restore = await postJournal(tx, actor, {
        date: input.returnedOn,
        memo: `FBA return stock ${product.sku}`,
        source: "FBA_RETURN_STOCK",
        lines: [
          { accountCode: account, debitCents: costCents, creditCents: 0, memo: `FBA return stock ${product.sku}` },
          { accountCode: CODES.cogs, debitCents: 0, creditCents: costCents, memo: `FBA return cogs ${product.sku}` },
        ],
        isExample: true,
      });
      if (!restore.ok) return restore;
    }
    return ok({ qty: input.qty });
  });
}

export async function reimburseFbaLoss(
  actor: Actor,
  input: { productId: string; qty: number; reimbursementCents: number; lostOn: Date },
): Promise<Result<{ costCents: number }>> {
  const denied = deny(actor, "importData");
  if (denied) return denied;
  return run(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) return err("That product was not found.");
    const account = inventoryAccount(product.kind);
    if (!account) return err("This item is not stored in inventory.");
    const taken = await takeFromFba(tx, product.id, input.qty, input.lostOn, "FBA_LOSS", product.id);
    if (!taken.ok) return taken;
    const costCents = taken.value.reduce((sum, line) => sum + line.costCents, 0);
    const loss = await postJournal(tx, actor, {
      date: input.lostOn,
      memo: `FBA lost ${product.sku}`,
      source: "FBA_LOSS",
      lines: [
        { accountCode: CODES.cogs, debitCents: costCents, creditCents: 0, memo: `FBA lost ${product.sku}` },
        { accountCode: account, debitCents: 0, creditCents: costCents, memo: `FBA lost ${product.sku}` },
      ],
      isExample: true,
    });
    if (!loss.ok) return loss;
    if (input.reimbursementCents > 0) {
      const paid = await postJournal(tx, actor, {
        date: input.lostOn,
        memo: `FBA reimbursement ${product.sku}`,
        source: "FBA_REIMBURSE",
        lines: [
          { accountCode: CODES.amazonClearing, debitCents: input.reimbursementCents, creditCents: 0, memo: "Amazon reimbursement" },
          { accountCode: CODES.otherIncome, debitCents: 0, creditCents: input.reimbursementCents, memo: `FBA reimbursement ${product.sku}` },
        ],
        isExample: true,
      });
      if (!paid.ok) return paid;
    }
    return ok({ costCents });
  });
}

export async function postFbaStorageFee(actor: Actor, input: { cents: number; on: Date; sku?: string }): Promise<Result<{ cents: number }>> {
  const denied = deny(actor, "importData");
  if (denied) return denied;
  if (!(input.cents > 0)) return err("Enter the storage fee.");
  return run(async (tx) => {
    const journal = await postJournal(tx, actor, {
      date: input.on,
      memo: `FBA storage ${input.sku ?? ""}`.trim(),
      source: "FBA_STORAGE",
      lines: [
        { accountCode: CODES.amazonFees, debitCents: input.cents, creditCents: 0, memo: "FBA storage fee" },
        { accountCode: CODES.amazonClearing, debitCents: 0, creditCents: input.cents, memo: "Amazon deducted storage" },
      ],
      isExample: true,
    });
    if (!journal.ok) return journal;
    return ok({ cents: input.cents });
  });
}

export async function settleFbaDeposit(actor: Actor, input: { cents: number; on: Date; reference: string }): Promise<Result<{ cents: number }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  if (!(input.cents > 0)) return err("Enter the deposit.");
  return run(async (tx) => {
    const journal = await postJournal(tx, actor, {
      date: input.on,
      memo: `FBA deposit ${input.reference}`,
      source: "FBA_DEPOSIT",
      sourceId: input.reference,
      lines: [
        { accountCode: CODES.cash, debitCents: input.cents, creditCents: 0, memo: "Amazon settlement deposit" },
        { accountCode: CODES.amazonClearing, debitCents: 0, creditCents: input.cents, memo: "Due from Amazon cleared" },
      ],
      isExample: true,
    });
    if (!journal.ok) return journal;
    await tx.invoice.updateMany({
      where: { channel: "AMAZON", fulfillment: "FBA", status: { in: ["OPEN", "PARTIAL"] } },
      data: { balanceCents: 0, status: "PAID" },
    });
    return ok({ cents: input.cents });
  });
}

export async function trueUpFba(
  actor: Actor,
  input: { on: Date; rows: { productId: string; reportQty: number }[] },
): Promise<Result<{ variances: { sku: string; spikeQty: number; reportQty: number; delta: number }[] }>> {
  const denied = deny(actor, "manualJournal");
  if (denied) return denied;
  return run(async (tx) => {
    const amazon = await locationByCode(tx, "AMAZON");
    const variances: { sku: string; spikeQty: number; reportQty: number; delta: number }[] = [];
    for (const row of input.rows) {
      const product = await tx.product.findUnique({ where: { id: row.productId } });
      if (!product) return err("A true-up product was not found.");
      const balances = await loadBalances(tx, [product.id]);
      const spikeQty = balances.reduce((sum, lot) => sum + (lot.locations.find((place) => place.locationId === amazon.id)?.qty ?? 0), 0);
      const delta = Math.round((row.reportQty - spikeQty) * 10000) / 10000;
      variances.push({ sku: product.sku, spikeQty, reportQty: row.reportQty, delta });
      if (Math.abs(delta) < 0.0001) continue;
      const account = inventoryAccount(product.kind);
      if (!account) return err(`${product.name} is not stored in inventory.`);
      const lot = await tx.lot.findFirst({ where: { productId: product.id, origin: "FBA" }, orderBy: { receivedOn: "desc" } });
      if (!lot) return err(`${product.sku} has no FBA lot to true up.`);
      const costCents = valueCents(Math.abs(delta), Number(lot.unitCost));
      await tx.movement.create({
        data: {
          at: input.on,
          lotId: lot.id,
          productId: product.id,
          locationId: amazon.id,
          qty: delta,
          reason: "FBA_TRUEUP",
          refType: "Fba",
          refId: lot.id,
          note: `Report ${row.reportQty}, books ${spikeQty}`,
        },
      });
      const lines = delta > 0
        ? [
            { accountCode: account, debitCents: costCents, creditCents: 0, memo: `FBA true-up ${product.sku}` },
            { accountCode: CODES.adjustment, debitCents: 0, creditCents: costCents, memo: `FBA true-up ${product.sku}` },
          ]
        : [
            { accountCode: CODES.adjustment, debitCents: costCents, creditCents: 0, memo: `FBA true-up ${product.sku}` },
            { accountCode: account, debitCents: 0, creditCents: costCents, memo: `FBA true-up ${product.sku}` },
          ];
      const journal = await postJournal(tx, actor, {
        date: input.on,
        memo: `FBA true-up ${product.sku}`,
        source: "FBA_TRUEUP",
        lines,
        isExample: true,
      });
      if (!journal.ok) return journal;
    }
    return ok({ variances });
  });
}

export async function fbaMargin(productId: string): Promise<{ sku: string; netSalesCents: number; cogsCents: number; feeCents: number; marginCents: number }> {
  const product = await prismaProduct(productId);
  const lines = await loadFbaJournals(product.sku);
  const netSalesCents = sumMemo(lines, `FBA sale ${product.sku}`, "credit") - sumMemo(lines, `FBA return revenue ${product.sku}`, "debit");
  const cogsCents = sumMemo(lines, `FBA cogs ${product.sku}`, "debit") - sumMemo(lines, `FBA return cogs ${product.sku}`, "credit");
  const feeCents = sumMemo(lines, `FBA fee ${product.sku}`, "debit");
  return { sku: product.sku, netSalesCents, cogsCents, feeCents, marginCents: netSalesCents - cogsCents - feeCents };
}

async function prismaProduct(productId: string) {
  const { prisma } = await import("../db");
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  return product;
}

async function loadFbaJournals(sku: string) {
  const { prisma } = await import("../db");
  return prisma.journalLine.findMany({
    where: { memo: { contains: sku }, entry: { source: { startsWith: "FBA_" } } },
    include: { account: true },
  });
}

function sumMemo(lines: { memo: string; debitCents: number; creditCents: number }[], memo: string, side: "debit" | "credit") {
  return lines.filter((line) => line.memo === memo).reduce((sum, line) => sum + (side === "debit" ? line.debitCents : line.creditCents), 0);
}

export function fbaDate(iso: string): Date {
  return parseDateInput(iso) ?? new Date(`${iso}T12:00:00Z`);
}
