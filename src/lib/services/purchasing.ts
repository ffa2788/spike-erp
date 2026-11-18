import { addDays } from "../dates";
import { inventoryAccount } from "../chart";
import { valueCents } from "../inventory";
import { receiptJournal, vendorBillJournal, vendorPaymentJournal } from "../journals";
import { buyPriceProblem } from "../pricing";
import { err, ok, type Result } from "../result";
import { audit, deny, locationByCode, nextNumber, postJournal, run, type Actor, type Tx } from "./shared";

type PoLineInput = { productId: string; qty: number; unitPrice: number; allowOneDollar?: boolean };

export async function savePurchaseOrder(
  actor: Actor,
  input: {
    id?: string;
    partyId: string;
    orderedOn: Date;
    expectedOn: Date | null;
    notes: string;
    send: boolean;
    isExample?: boolean;
    lines: PoLineInput[];
  },
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run(async (tx) => {
    const vendor = await tx.party.findUnique({ where: { id: input.partyId } });
    if (!vendor?.isVendor || !vendor.active) return err("Choose an active supplier.");
    const existing = input.id ? await tx.purchaseOrder.findUnique({ where: { id: input.id }, include: { receipts: true } }) : null;
    if (input.id && !existing) return err("That purchase order was not found.");
    if (existing && existing.receipts.length) return err("This purchase order already has a receipt, so the lines stay as they are.");
    if (existing && existing.status === "CANCELLED") return err("This purchase order is cancelled.");
    const lines = input.lines.filter((line) => line.qty > 0);
    if (lines.length === 0) return err("Add at least one material and quantity.");
    const priced: { productId: string; description: string; qty: number; unitPriceCents: number }[] = [];
    for (const line of lines) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product?.active) return err("One of the materials is missing or inactive.");
      if (!product.trackInventory) return err(`${product.name} is not stored in inventory, so it does not go on a purchase order.`);
      const problem = buyPriceProblem(line.unitPrice, Boolean(line.allowOneDollar));
      if (problem) return err(`${product.name}: ${problem}`);
      priced.push({
        productId: product.id,
        description: product.name,
        qty: line.qty,
        unitPriceCents: Math.round(line.unitPrice * 100),
      });
    }
    const data = {
      partyId: vendor.id,
      orderedOn: input.orderedOn,
      expectedOn: input.expectedOn,
      notes: input.notes.trim(),
      status: input.send ? "SENT" as const : "DRAFT" as const,
      isExample: input.isExample ?? false,
    };
    const saved = existing
      ? await tx.purchaseOrder.update({
          where: { id: existing.id },
          data: { ...data, lines: { deleteMany: {}, create: priced.map((line, index) => ({ ...line, sort: index })) } },
        })
      : await tx.purchaseOrder.create({
          data: {
            ...data,
            number: await nextNumber(tx, "po"),
            lines: { create: priced.map((line, index) => ({ ...line, sort: index })) },
          },
        });
    await audit(tx, actor, existing ? "update" : "create", "PurchaseOrder", saved.id, `Saved purchase order ${saved.number}.`);
    return ok({ id: saved.id });
  });
}

export async function cancelPurchaseOrder(actor: Actor, orderId: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { receipts: true } });
    if (!order) return err("That purchase order was not found.");
    if (order.receipts.length) return err("This purchase order already has a receipt, so it cannot be cancelled.");
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    await audit(tx, actor, "cancel", "PurchaseOrder", order.id, `Cancelled purchase order ${order.number}.`);
    return ok({ id: order.id });
  });
}

export async function receivePurchaseOrder(
  actor: Actor,
  input: {
    orderId: string;
    receivedOn: Date;
    notes: string;
    lines: { orderLineId: string; qty: number; supplierLot: string; expiresOn: Date | null }[];
  },
): Promise<Result<{ receiptId: string }>> {
  const denied = deny(actor, "receive");
  if (denied) return denied;
  return run((tx) => receiveTx(tx, actor, input));
}

async function receiveTx(
  tx: Tx,
  actor: Actor,
  input: {
    orderId: string;
    receivedOn: Date;
    notes: string;
    lines: { orderLineId: string; qty: number; supplierLot: string; expiresOn: Date | null }[];
  },
): Promise<Result<{ receiptId: string }>> {
  const order = await tx.purchaseOrder.findUnique({
    where: { id: input.orderId },
    include: { lines: { include: { product: true } } },
  });
  if (!order) return err("That purchase order was not found.");
  if (order.status === "DRAFT" || order.status === "CANCELLED") return err("Send the purchase order before receiving it.");
  const qc = await locationByCode(tx, "QC");
  const chosen = input.lines.filter((line) => line.qty > 0);
  if (chosen.length === 0) return err("Enter a quantity received.");
  const receipt = await tx.receipt.create({
    data: {
      number: await nextNumber(tx, "receipt"),
      orderId: order.id,
      receivedOn: input.receivedOn,
      notes: input.notes.trim(),
      isExample: order.isExample,
    },
  });
  const debits = new Map<string, number>();
  for (const chosenLine of chosen) {
    const line = order.lines.find((item) => item.id === chosenLine.orderLineId);
    if (!line) return err("A receipt line is not on the purchase order.");
    const remaining = Number(line.qty) - Number(line.qtyReceived);
    if (chosenLine.qty - remaining > 0.0001) {
      return err(`${line.product.name}: only ${remaining} ${line.product.unit} is still open.`);
    }
    if (!chosenLine.supplierLot.trim()) return err(`${line.product.name}: enter the supplier's lot number.`);
    const account = inventoryAccount(line.product.kind);
    if (!account) return err(`${line.product.name} is not stored in inventory.`);
    const unitCost = line.unitPriceCents / 100;
    const cents = valueCents(chosenLine.qty, unitCost);
    const expires = chosenLine.expiresOn ?? (line.product.shelfLifeDays ? new Date(input.receivedOn.getTime() + line.product.shelfLifeDays * 86400000) : null);
    const lot = await tx.lot.create({
      data: {
        lotNumber: await nextNumber(tx, "lot"),
        productId: line.productId,
        qcStatus: "QUARANTINE",
        unitCost,
        receivedOn: input.receivedOn,
        expiresOn: expires,
        supplierLot: chosenLine.supplierLot.trim(),
        origin: "RECEIPT",
        isExample: order.isExample,
        notes: `Received on ${receipt.number}`,
      },
    });
    await tx.movement.create({
      data: {
        lotId: lot.id,
        productId: line.productId,
        locationId: qc.id,
        qty: chosenLine.qty,
        reason: "RECEIPT",
        refType: "Receipt",
        refId: receipt.id,
      },
    });
    await tx.receiptLine.create({
      data: {
        receiptId: receipt.id,
        orderLineId: line.id,
        lotId: lot.id,
        qty: chosenLine.qty,
        supplierLot: chosenLine.supplierLot.trim(),
        expiresOn: expires,
      },
    });
    await tx.purchaseOrderLine.update({
      where: { id: line.id },
      data: { qtyReceived: Number(line.qtyReceived) + chosenLine.qty },
    });
    debits.set(account, (debits.get(account) ?? 0) + cents);
  }
  const journal = await postJournal(tx, actor, {
    date: input.receivedOn,
    memo: `Receipt ${receipt.number}`,
    source: "RECEIPT",
    sourceId: receipt.id,
    lines: receiptJournal([...debits.entries()].map(([accountCode, cents]) => ({ accountCode, cents }))),
    isExample: order.isExample,
  });
  if (!journal.ok) return journal;
  await tx.receipt.update({ where: { id: receipt.id }, data: { journalId: journal.value } });
  const fresh = await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } });
  const open = fresh.some((line) => Number(line.qty) - Number(line.qtyReceived) > 0.0001);
  await tx.purchaseOrder.update({
    where: { id: order.id },
    data: { status: open ? "PARTLY_RECEIVED" : "RECEIVED" },
  });
  await audit(tx, actor, "receive", "Receipt", receipt.id, `Received ${receipt.number} against ${order.number}. Lots are waiting for quality.`);
  return ok({ receiptId: receipt.id });
}

export async function billReceipt(
  actor: Actor,
  input: { receiptId: string; vendorRef: string; billedOn: Date; lines: { receiptLineId: string; unitPrice: number; allowOneDollar?: boolean }[] },
): Promise<Result<{ billId: string }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const receipt = await tx.receipt.findUnique({
      where: { id: input.receiptId },
      include: { bill: true, order: { include: { party: true } }, lines: { include: { lot: true, orderLine: { include: { product: true } } } } },
    });
    if (!receipt) return err("That receipt was not found.");
    if (receipt.bill) return err("This receipt already has a supplier bill.");
    if (!input.vendorRef.trim()) return err("Enter the supplier's invoice number.");
    let receiptValue = 0;
    let billTotal = 0;
    const billLines: { productId: string; description: string; qty: number; unitPriceCents: number; receiptValueCents: number }[] = [];
    for (const line of receipt.lines) {
      const edited = input.lines.find((item) => item.receiptLineId === line.id);
      const unitPrice = edited ? edited.unitPrice : line.orderLine.unitPriceCents / 100;
      const problem = buyPriceProblem(unitPrice, Boolean(edited?.allowOneDollar));
      if (problem) return err(`${line.orderLine.product.name}: ${problem}`);
      const unitPriceCents = Math.round(unitPrice * 100);
      const receivedCents = valueCents(Number(line.qty), Number(line.lot.unitCost));
      const billedCents = Math.round(Number(line.qty) * unitPriceCents);
      receiptValue += receivedCents;
      billTotal += billedCents;
      billLines.push({
        productId: line.orderLine.productId,
        description: line.orderLine.description,
        qty: Number(line.qty),
        unitPriceCents,
        receiptValueCents: receivedCents,
      });
      await tx.product.update({
        where: { id: line.orderLine.productId },
        data: { lastPurchasePrice: unitPrice },
      });
    }
    const bill = await tx.vendorBill.create({
      data: {
        number: await nextNumber(tx, "bill"),
        partyId: receipt.order.partyId,
        receiptId: receipt.id,
        vendorRef: input.vendorRef.trim(),
        billedOn: input.billedOn,
        dueOn: addDays(input.billedOn, receipt.order.party.paymentTermsDays),
        subtotalCents: billTotal,
        totalCents: billTotal,
        balanceCents: billTotal,
        isExample: receipt.isExample,
        lines: { create: billLines },
      },
    });
    const journal = await postJournal(tx, actor, {
      date: input.billedOn,
      memo: `Supplier bill ${bill.number}`,
      source: "VENDOR_BILL",
      sourceId: bill.id,
      lines: vendorBillJournal(receiptValue, billTotal),
      isExample: receipt.isExample,
    });
    if (!journal.ok) return journal;
    await tx.vendorBill.update({ where: { id: bill.id }, data: { journalId: journal.value } });
    await audit(tx, actor, "bill", "VendorBill", bill.id, `Entered supplier bill ${bill.number} for ${receipt.number}.`);
    return ok({ billId: bill.id });
  });
}

export async function payBill(
  actor: Actor,
  input: { billId: string; amountCents: number; paidOn: Date; method: string; reference: string },
): Promise<Result<{ paymentId: string }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const bill = await tx.vendorBill.findUnique({ where: { id: input.billId }, include: { party: true } });
    if (!bill) return err("That bill was not found.");
    if (!input.method.trim() || !input.reference.trim()) return err("Enter how you paid and a reference, such as a check number.");
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return err("Enter a payment greater than zero.");
    if (input.amountCents > bill.balanceCents) return err("That payment is more than the open balance.");
    const payment = await tx.vendorPayment.create({
      data: {
        number: await nextNumber(tx, "vpay"),
        partyId: bill.partyId,
        billId: bill.id,
        paidOn: input.paidOn,
        amountCents: input.amountCents,
        method: input.method.trim(),
        reference: input.reference.trim(),
        isExample: bill.isExample,
      },
    });
    const balance = bill.balanceCents - input.amountCents;
    await tx.vendorBill.update({
      where: { id: bill.id },
      data: { balanceCents: balance, status: balance === 0 ? "PAID" : "PARTIAL" },
    });
    const journal = await postJournal(tx, actor, {
      date: input.paidOn,
      memo: `Supplier payment ${payment.number}`,
      source: "VENDOR_PAYMENT",
      sourceId: payment.id,
      lines: vendorPaymentJournal(input.amountCents),
      isExample: bill.isExample,
    });
    if (!journal.ok) return journal;
    await tx.vendorPayment.update({ where: { id: payment.id }, data: { journalId: journal.value } });
    await audit(tx, actor, "pay", "VendorPayment", payment.id, `Paid ${bill.party.name} with ${payment.number}.`);
    return ok({ paymentId: payment.id });
  });
}
