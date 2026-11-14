import type { Channel } from "@prisma/client";
import { addDays, toDateInput } from "../dates";
import { CODES, inventoryAccount } from "../chart";
import { fefoAllocate, lotQty, reliefCents, roundQty } from "../inventory";
import { cogsJournal, salesJournal, shipJournal, type DraftLine } from "../journals";
import { shipBlockReason } from "../nsf";
import { buyPriceProblem, sellBlockReason } from "../pricing";
import { err, ok, type Result } from "../result";
import { computeSalesTax } from "../tax";
import {
  applyEarlyPay,
  dueDays,
  invoiceSequenceName,
  nextRevision,
  priceLines,
  quoteLabel,
  resolveUnitPrice,
  termCharges,
  type CreditTermName,
  type DiscountKindName,
  type IncotermName,
} from "../commercial";
import { audit, deny, loadBalances, nextNumber, postJournal, run, type Actor, type Tx } from "./shared";

type LineInput = {
  productId: string;
  qty: number;
  specialPrice: number | null;
  discountKind?: DiscountKindName;
  discountValue?: number;
};

type TermsInput = {
  incoterm?: IncotermName;
  namedPlace?: string;
  currency?: string;
  creditTerm?: CreditTermName;
  customNetDays?: number;
  earlyPayBps?: number;
  earlyPayDays?: number;
  freightCents?: number;
  insuranceCents?: number;
  docDiscountKind?: DiscountKindName;
  docDiscountValue?: number;
};

function termsData(input: TermsInput) {
  const incoterm = input.incoterm ?? "EXW";
  const charges = termCharges(incoterm);
  return {
    incoterm,
    namedPlace: (input.namedPlace ?? "").trim(),
    currency: (input.currency ?? "USD").trim().toUpperCase() || "USD",
    creditTerm: input.creditTerm ?? "NET_30",
    customNetDays: input.customNetDays ?? 30,
    earlyPayBps: input.earlyPayBps ?? 0,
    earlyPayDays: input.earlyPayDays ?? 0,
    freightCents: charges.sellerFreight ? input.freightCents ?? 0 : 0,
    insuranceCents: charges.sellerInsurance ? input.insuranceCents ?? 0 : 0,
    docDiscountKind: input.docDiscountKind ?? "NONE",
    docDiscountValue: input.docDiscountValue ?? 0,
    charges,
  };
}

async function activeRates(tx: Tx) {
  const rates = await tx.taxRate.findMany({ where: { active: true } });
  return rates.map((rate) => ({
    state: rate.state,
    locality: rate.locality,
    name: rate.name,
    rateBps: rate.rateBps,
    active: rate.active,
  }));
}

function lineAmount(qty: number, unitPriceCents: number): number {
  return Math.round(qty * unitPriceCents);
}

export async function saveQuote(
  actor: Actor,
  input: {
    id?: string;
    partyId: string;
    issuedOn: Date;
    validUntil: Date;
    notes: string;
    lines: LineInput[];
    terms?: TermsInput;
    isExample?: boolean;
  },
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run((tx) => saveQuoteTx(tx, actor, input));
}

async function saveQuoteTx(
  tx: Tx,
  actor: Actor,
  input: {
    id?: string;
    partyId: string;
    issuedOn: Date;
    validUntil: Date;
    notes: string;
    lines: LineInput[];
    terms?: TermsInput;
    isExample?: boolean;
  },
): Promise<Result<{ id: string }>> {
  const party = await tx.party.findUnique({ where: { id: input.partyId } });
  if (!party?.isCustomer || !party.active) return err("Choose an active customer.");
  const lines = input.lines.filter((line) => line.qty > 0);
  if (lines.length === 0) return err("Add at least one product and quantity.");
  if (input.id) {
    const existing = await tx.quote.findUnique({ where: { id: input.id } });
    if (!existing) return err("That quote was not found.");
    if (existing.status === "ACCEPTED") return err("This quote was already accepted. Change the order instead.");
  }
  const terms = termsData(input.terms ?? {});
  if (!terms.namedPlace) return err("Enter the named place for the shipping term, such as Clearwater plant.");
  if (terms.freightCents < 0 || terms.insuranceCents < 0) return err("Freight and insurance cannot be negative.");
  const priced: {
    productId: string;
    description: string;
    qty: number;
    unitPriceCents: number;
    taxable: boolean;
    discountKind: DiscountKindName;
    discountValue: number;
    priceSource: string;
  }[] = [];
  for (const line of lines) {
    const product = await tx.product.findUnique({ where: { id: line.productId } });
    if (!product) return err("One of the products was not found.");
    const block = sellBlockReason({
      active: product.active,
      sellable: product.sellable,
      priceStatus: product.priceStatus,
      listPrice: product.listPrice == null ? null : Number(product.listPrice),
    });
    if (block) return err(`${product.name}: ${block}`);
    const listCents = Math.round(Number(product.listPrice) * 100);
    const breaks = await tx.priceBreak.findMany({ where: { productId: product.id, priceLevel: party.priceLevel } });
    const level = breaks.find((row) => Number(row.minQty) === 0);
    const resolved = line.specialPrice == null
      ? resolveUnitPrice({
          qty: line.qty,
          listCents,
          levelCents: level ? level.unitPriceCents : party.priceLevel === "LIST" ? null : null,
          breaks: breaks.filter((row) => Number(row.minQty) > 0).map((row) => ({ minQty: Number(row.minQty), unitPriceCents: row.unitPriceCents })),
        })
      : { unitPriceCents: Math.round(line.specialPrice * 100), source: "Special price" };
    const priceProblem = buyPriceProblem(resolved.unitPriceCents / 100, product.allowOneDollar);
    if (priceProblem) return err(`${product.name}: ${priceProblem}`);
    priced.push({
      productId: product.id,
      description: product.name,
      qty: line.qty,
      unitPriceCents: resolved.unitPriceCents,
      taxable: product.taxable,
      discountKind: line.discountKind ?? "NONE",
      discountValue: line.discountValue ?? 0,
      priceSource: line.specialPrice == null ? resolved.source : "Special price",
    });
  }
  const goods = priceLines({
    lines: priced.map((line) => ({
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      taxable: line.taxable,
      discountKind: line.discountKind,
      discountValue: line.discountValue,
    })),
    docKind: terms.docDiscountKind,
    docValue: terms.docDiscountValue,
  });
  if ("error" in goods) return err(goods.error);
  const taxLines = goods.lines.map((line) => ({ amountCents: line.afterDocCents, taxable: line.taxable }));
  if (terms.freightCents + terms.insuranceCents > 0 && goods.lines.some((line) => line.taxable)) {
    taxLines.push({ amountCents: terms.freightCents + terms.insuranceCents, taxable: true });
  }
  const tax = computeSalesTax({
    shipState: party.shipState || party.billState,
    taxLocality: party.taxLocality,
    rates: await activeRates(tx),
    lines: taxLines,
    exempt: party.taxExempt,
    exemptionExpires: party.exemptionExpires ? toDateInput(party.exemptionExpires) : null,
    exemptionState: party.exemptionState,
    asOf: toDateInput(input.issuedOn),
  });
  const subtotalCents = goods.goodsNetCents + terms.freightCents + terms.insuranceCents;
  const totalCents = subtotalCents + tax.taxCents;
  const commercial = {
    incoterm: terms.incoterm,
    namedPlace: terms.namedPlace,
    currency: terms.currency,
    creditTerm: terms.creditTerm,
    customNetDays: terms.customNetDays,
    earlyPayBps: terms.earlyPayBps,
    earlyPayDays: terms.earlyPayDays,
    freightCents: terms.freightCents,
    insuranceCents: terms.insuranceCents,
    docDiscountKind: terms.docDiscountKind,
    docDiscountValue: terms.docDiscountValue,
    discountCents: goods.lineDiscountCents + goods.docDiscountCents,
    goodsNetCents: goods.goodsNetCents,
    subtotalCents,
    taxCents: tax.taxCents,
    totalCents,
  };
  const lineData = priced.map((line, index) => ({
    productId: line.productId,
    description: line.description,
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    discountKind: line.discountKind,
    discountValue: line.discountValue,
    discountCents: goods.lines[index].lineDiscountCents + goods.lines[index].docShareCents,
    priceSource: line.priceSource,
    sort: index,
  }));
  const saved = input.id
    ? await tx.quote.update({
        where: { id: input.id },
        data: {
          partyId: party.id,
          issuedOn: input.issuedOn,
          validUntil: input.validUntil,
          notes: input.notes.trim(),
          isExample: input.isExample ?? false,
          shipStreet: party.shipStreet,
          shipCity: party.shipCity,
          shipState: party.shipState || party.billState,
          shipZip: party.shipZip,
          taxLocality: party.taxLocality,
          ...commercial,
          lines: { deleteMany: {}, create: lineData },
        },
      })
    : await tx.quote.create({
        data: {
          number: await nextNumber(tx, "quote"),
          revision: "A",
          partyId: party.id,
          issuedOn: input.issuedOn,
          validUntil: input.validUntil,
          notes: input.notes.trim(),
          isExample: input.isExample ?? false,
          shipStreet: party.shipStreet,
          shipCity: party.shipCity,
          shipState: party.shipState || party.billState,
          shipZip: party.shipZip,
          taxLocality: party.taxLocality,
          ...commercial,
          lines: { create: lineData },
        },
      });
  await audit(tx, actor, input.id ? "update" : "create", "Quote", saved.id, `Saved ${quoteLabel(saved.number, saved.revision)} for ${party.name}.`);
  return ok({ id: saved.id });
}

export async function markQuote(
  actor: Actor,
  quoteId: string,
  status: "SENT" | "REJECTED" | "EXPIRED",
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run(async (tx) => {
    const quote = await tx.quote.findUnique({ where: { id: quoteId } });
    if (!quote) return err("That quote was not found.");
    if (quote.status === "ACCEPTED") return err("This quote was already turned into an order.");
    await tx.quote.update({ where: { id: quote.id }, data: { status } });
    await audit(tx, actor, "update", "Quote", quote.id, `Marked quote ${quote.number} as ${status.toLowerCase()}.`);
    return ok({ id: quote.id });
  });
}

export async function acceptQuote(actor: Actor, quoteId: string): Promise<Result<{ orderId: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: { lines: true, party: true, order: true },
    });
    if (!quote) return err("That quote was not found.");
    if (quote.order) return err("This quote already has an order.");
    if (quote.status === "REJECTED" || quote.status === "EXPIRED" || quote.status === "SUPERSEDED") {
      return err("This quote revision is closed. Open the latest revision.");
    }
    if (quote.validUntil < quote.issuedOn) return err("The valid-until date is before the quote date.");
    const open = await tx.invoice.aggregate({
      where: { partyId: quote.partyId, status: { in: ["OPEN", "PARTIAL"] } },
      _sum: { balanceCents: true },
    });
    const owed = open._sum.balanceCents ?? 0;
    if (quote.party.creditLimitCents > 0 && owed + quote.totalCents > quote.party.creditLimitCents) {
      return err("This order would put the customer over their credit limit.");
    }
    const order = await tx.salesOrder.create({
      data: {
        number: await nextNumber(tx, "order"),
        partyId: quote.partyId,
        quoteId: quote.id,
        orderedOn: quote.issuedOn,
        shipStreet: quote.shipStreet,
        shipCity: quote.shipCity,
        shipState: quote.shipState,
        shipZip: quote.shipZip,
        taxLocality: quote.taxLocality,
        notes: quote.notes,
        incoterm: quote.incoterm,
        namedPlace: quote.namedPlace,
        currency: quote.currency,
        creditTerm: quote.creditTerm,
        customNetDays: quote.customNetDays,
        earlyPayBps: quote.earlyPayBps,
        earlyPayDays: quote.earlyPayDays,
        freightCents: quote.freightCents,
        insuranceCents: quote.insuranceCents,
        docDiscountKind: quote.docDiscountKind,
        docDiscountValue: quote.docDiscountValue,
        discountCents: quote.discountCents,
        goodsNetCents: quote.goodsNetCents,
        isExample: quote.isExample,
        lines: {
          create: quote.lines.map((line) => ({
            productId: line.productId,
            description: line.description,
            qty: line.qty,
            unitPriceCents: line.unitPriceCents,
            discountKind: line.discountKind,
            discountValue: line.discountValue,
            discountCents: line.discountCents,
            sort: line.sort,
          })),
        },
      },
    });
    await tx.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED" } });
    await audit(tx, actor, "accept", "Quote", quote.id, `Accepted ${quoteLabel(quote.number, quote.revision)} and created order ${order.number}.`);
    return ok({ orderId: order.id });
  });
}

export async function cancelOrder(actor: Actor, orderId: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: orderId }, include: { deliveries: true } });
    if (!order) return err("That order was not found.");
    if (order.deliveries.length) return err("This order has a shipment, so it cannot be cancelled.");
    if (order.status === "CANCELLED") return err("This order is already cancelled.");
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    await audit(tx, actor, "cancel", "SalesOrder", order.id, `Cancelled order ${order.number}.`);
    return ok({ id: order.id });
  });
}

type ShipRequest = { orderLineId: string; qty: number };

export async function shipOrder(
  actor: Actor,
  input: { orderId: string; shipAll?: boolean; quantities?: ShipRequest[]; shippedOn: Date; carrier: string; tracking: string; notes: string },
): Promise<Result<{ deliveryId: string }>> {
  const denied = deny(actor, "ship");
  if (denied) return denied;
  return run((tx) => shipOrderTx(tx, actor, input));
}

export async function shipOrderTx(
  tx: Tx,
  actor: Actor,
  input: { orderId: string; shipAll?: boolean; quantities?: ShipRequest[]; shippedOn: Date; carrier: string; tracking: string; notes: string },
): Promise<Result<{ deliveryId: string }>> {
  const order = await tx.salesOrder.findUnique({
    where: { id: input.orderId },
    include: { lines: { include: { product: true } }, deliveries: { include: { lines: true } } },
  });
  if (!order) return err("That order was not found.");
  if (order.status === "CANCELLED") return err("This order is cancelled.");
  const already = new Map<string, number>();
  for (const delivery of order.deliveries) {
    for (const line of delivery.lines) already.set(line.orderLineId, (already.get(line.orderLineId) ?? 0) + Number(line.qty));
  }
  const requests: ShipRequest[] = input.shipAll
    ? order.lines.map((line) => ({ orderLineId: line.id, qty: roundQty(Number(line.qty) - (already.get(line.id) ?? 0)) })).filter((line) => line.qty > 0)
    : (input.quantities ?? []).filter((line) => line.qty > 0);
  if (requests.length === 0) return err("There is nothing left to ship.");
  const asOf = toDateInput(input.shippedOn);
  const mutable = (await loadBalances(tx, order.lines.map((line) => line.productId))).map((lot) => ({
    ...lot,
    locations: lot.locations.map((location) => ({ ...location })),
  }));
  const picks: { orderLineId: string; lotId: string; locationId: string; qty: number; cogsCents: number }[] = [];
  for (const request of requests) {
    const line = order.lines.find((item) => item.id === request.orderLineId);
    if (!line) return err("A shipment line is not on the order.");
    const remaining = roundQty(Number(line.qty) - (already.get(line.id) ?? 0));
    if (request.qty - remaining > 0.0001) {
      return err(`${line.product.name}: you can ship at most ${remaining} ${line.product.unit}.`);
    }
    if (!line.product.trackInventory) return err(`${line.product.name} is not stored in inventory.`);
    const allocation = fefoAllocate(mutable, line.productId, request.qty, asOf);
    if (!allocation.ok) return err(`${line.product.name}: ${allocation.error}`);
    for (const pick of allocation.picks) {
      const reason = shipBlockReason(
        {
          name: line.product.name,
          nsfCertified: line.product.nsfCertified,
          nsfExpiresOn: line.product.nsfExpiresOn ? toDateInput(line.product.nsfExpiresOn) : null,
          nsfFormulaVersion: line.product.nsfFormulaVersion,
        },
        pick,
        asOf,
      );
      if (reason) return err(reason);
      const lot = mutable.find((item) => item.lotId === pick.lotId);
      const place = lot?.locations.find((item) => item.locationId === pick.locationId);
      if (!lot || !place) return err("A lot changed while the shipment was being saved.");
      const before = lotQty(lot);
      place.qty = roundQty(place.qty - pick.qty);
      const cogsCents = reliefCents(before, lotQty(lot), lot.unitCost);
      picks.push({ orderLineId: line.id, lotId: pick.lotId, locationId: pick.locationId, qty: pick.qty, cogsCents });
    }
  }
  const delivery = await tx.delivery.create({
    data: {
      number: await nextNumber(tx, "delivery"),
      orderId: order.id,
      shippedOn: input.shippedOn,
      carrier: input.carrier.trim(),
      tracking: input.tracking.trim(),
      notes: input.notes.trim(),
      isExample: order.isExample,
    },
  });
  const credits = new Map<string, number>();
  for (const pick of picks) {
    const line = order.lines.find((item) => item.id === pick.orderLineId)!;
    const account = inventoryAccount(line.product.kind);
    if (!account) return err(`${line.product.name} has no inventory account.`);
    credits.set(account, (credits.get(account) ?? 0) + pick.cogsCents);
    await tx.deliveryLine.create({
      data: {
        deliveryId: delivery.id,
        orderLineId: pick.orderLineId,
        lotId: pick.lotId,
        qty: pick.qty,
        cogsCents: pick.cogsCents,
      },
    });
    await tx.movement.create({
      data: {
        lotId: pick.lotId,
        productId: line.productId,
        locationId: pick.locationId,
        qty: -pick.qty,
        reason: "SHIPMENT",
        refType: "Delivery",
        refId: delivery.id,
        note: delivery.number,
      },
    });
  }
  const journal = shipJournal([...credits.entries()].map(([accountCode, cents]) => ({ accountCode, cents })));
  const posted = await postJournal(tx, actor, {
    date: input.shippedOn,
    memo: `Shipment ${delivery.number}`,
    source: "SHIPMENT",
    sourceId: delivery.id,
    lines: journal,
    isExample: order.isExample,
  });
  if (!posted.ok) return posted;
  await tx.delivery.update({ where: { id: delivery.id }, data: { journalId: posted.value } });
  const stillOpen = order.lines.some((line) => {
    const shippedBefore = already.get(line.id) ?? 0;
    const shippedNow = picks.filter((pick) => pick.orderLineId === line.id).reduce((sum, pick) => sum + pick.qty, 0);
    return roundQty(Number(line.qty) - shippedBefore - shippedNow) > 0.0001;
  });
  await tx.salesOrder.update({
    where: { id: order.id },
    data: { status: stillOpen ? "PARTLY_SHIPPED" : "SHIPPED" },
  });
  await audit(tx, actor, "ship", "Delivery", delivery.id, `Shipped ${delivery.number} for order ${order.number}.`);
  return ok({ deliveryId: delivery.id });
}

export async function invoiceDelivery(actor: Actor, deliveryId: string, issuedOn: Date): Promise<Result<{ invoiceId: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run((tx) => invoiceDeliveryTx(tx, actor, deliveryId, issuedOn, 0));
}

export async function invoiceDeliveryTx(
  tx: Tx,
  actor: Actor,
  deliveryId: string,
  issuedOn: Date,
  feeCents: number,
): Promise<Result<{ invoiceId: string }>> {
  const delivery = await tx.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      invoice: true,
      lines: true,
      order: { include: { party: true, lines: { include: { product: true } } } },
    },
  });
  if (!delivery) return err("That delivery was not found.");
  if (delivery.invoice) return err("This delivery already has an invoice.");
  const party = delivery.order.party;
  const grouped = new Map<string, { qty: number; cogsCents: number }>();
  for (const line of delivery.lines) {
    const row = grouped.get(line.orderLineId) ?? { qty: 0, cogsCents: 0 };
    row.qty = roundQty(row.qty + Number(line.qty));
    row.cogsCents += line.cogsCents;
    grouped.set(line.orderLineId, row);
  }
  const orderGoods = delivery.order.lines.reduce((sum, line) => sum + lineAmount(Number(line.qty), line.unitPriceCents), 0);
  const invoiceLines = [...grouped.entries()].map(([orderLineId, row]) => {
    const orderLine = delivery.order.lines.find((line) => line.id === orderLineId)!;
    const full = lineAmount(Number(orderLine.qty), orderLine.unitPriceCents);
    const shipped = lineAmount(row.qty, orderLine.unitPriceCents);
    const ratio = full > 0 ? shipped / full : 1;
    const discountValue = orderLine.discountKind === "AMOUNT" ? Math.round(orderLine.discountValue * ratio) : orderLine.discountValue;
    return {
      productId: orderLine.productId,
      description: orderLine.description,
      qty: row.qty,
      unitPriceCents: orderLine.unitPriceCents,
      taxable: orderLine.product.taxable,
      discountKind: orderLine.discountKind,
      discountValue,
      cogsCents: row.cogsCents,
    };
  });
  const shippedGross = invoiceLines.reduce((sum, line) => sum + lineAmount(line.qty, line.unitPriceCents), 0);
  const docValue = delivery.order.docDiscountKind === "AMOUNT" && orderGoods > 0
    ? Math.round(delivery.order.docDiscountValue * (shippedGross / orderGoods))
    : delivery.order.docDiscountValue;
  const goods = priceLines({
    lines: invoiceLines.map((line) => ({
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      taxable: line.taxable,
      discountKind: line.discountKind,
      discountValue: line.discountValue,
    })),
    docKind: delivery.order.docDiscountKind,
    docValue,
  });
  if ("error" in goods) return err(goods.error);
  const freightShare = orderGoods > 0 ? Math.round(delivery.order.freightCents * (shippedGross / orderGoods)) : delivery.order.freightCents;
  const insuranceShare = orderGoods > 0 ? Math.round(delivery.order.insuranceCents * (shippedGross / orderGoods)) : delivery.order.insuranceCents;
  const channel = party.channel === "AMAZON" || party.channel === "WALMART" ? party.channel : delivery.order.party.channel;
  const marketplace = channel === "AMAZON" || channel === "WALMART";
  const taxLines = goods.lines.map((line) => ({ amountCents: line.afterDocCents, taxable: line.taxable }));
  if (!marketplace && freightShare + insuranceShare > 0 && goods.lines.some((line) => line.taxable)) {
    taxLines.push({ amountCents: freightShare + insuranceShare, taxable: true });
  }
  const tax = marketplace
    ? { taxableCents: 0, taxCents: 0, exemptionApplied: false, exemptionNumber: "", breakdown: [] as { name: string; rateBps: number; taxCents: number }[] }
    : computeSalesTax({
        shipState: delivery.order.shipState,
        taxLocality: delivery.order.taxLocality,
        rates: await activeRates(tx),
        lines: taxLines,
        exempt: party.taxExempt,
        exemptionExpires: party.exemptionExpires ? toDateInput(party.exemptionExpires) : null,
        exemptionState: party.exemptionState,
        asOf: toDateInput(issuedOn),
      });
  const goodsNetCents = goods.goodsNetCents;
  const discountCents = goods.lineDiscountCents + goods.docDiscountCents;
  const subtotalCents = goodsNetCents + freightShare + insuranceShare;
  const totalCents = subtotalCents + tax.taxCents;
  if (feeCents < 0 || feeCents > totalCents) return err("Fees cannot be negative or larger than the invoice.");
  const cogsCents = invoiceLines.reduce((sum, line) => sum + line.cogsCents, 0);
  const invoice = await tx.invoice.create({
    data: {
      number: await nextNumber(tx, invoiceSequenceName(channel)),
      partyId: party.id,
      orderId: delivery.orderId,
      deliveryId: delivery.id,
      issuedOn,
      dueOn: addDays(issuedOn, dueDays(delivery.order.creditTerm, delivery.order.customNetDays)),
      subtotalCents,
      taxCents: tax.taxCents,
      totalCents,
      balanceCents: totalCents - feeCents,
      feeCents,
      taxableCents: tax.taxableCents,
      taxJson: tax.breakdown,
      exemptionApplied: tax.exemptionApplied,
      exemptionNumber: tax.exemptionApplied ? party.exemptionNumber : "",
      channel,
      marketplaceOrderId: marketplace ? delivery.order.customerPo : "",
      incoterm: delivery.order.incoterm,
      namedPlace: delivery.order.namedPlace,
      currency: delivery.order.currency,
      creditTerm: delivery.order.creditTerm,
      customNetDays: delivery.order.customNetDays,
      earlyPayBps: delivery.order.earlyPayBps,
      earlyPayDays: delivery.order.earlyPayDays,
      freightCents: freightShare,
      insuranceCents: insuranceShare,
      docDiscountKind: delivery.order.docDiscountKind,
      docDiscountValue: docValue,
      discountCents,
      goodsNetCents,
      notes: channel === "AMAZON"
        ? `Amazon order ${delivery.order.customerPo}. SPIKE did not add sales tax.`
        : channel === "WALMART"
          ? `Walmart order ${delivery.order.customerPo}. SPIKE did not add sales tax.`
          : "",
      isExample: delivery.isExample,
      lines: {
        create: invoiceLines.map((line, index) => ({
          productId: line.productId,
          description: line.description,
          qty: line.qty,
          unitPriceCents: line.unitPriceCents,
          taxable: line.taxable,
          discountKind: line.discountKind,
          discountValue: line.discountValue,
          discountCents: goods.lines[index].lineDiscountCents + goods.lines[index].docShareCents,
          cogsCents: line.cogsCents,
        })),
      },
    },
  });
  const sales = await postJournal(tx, actor, {
    date: issuedOn,
    memo: `Invoice ${invoice.number}`,
    source: "INVOICE",
    sourceId: invoice.id,
    lines: salesJournal({ subtotalCents, taxCents: tax.taxCents, totalCents, feeCents, discountCents }),
    isExample: delivery.isExample,
  });
  if (!sales.ok) return sales;
  let cogsId: string | null = null;
  if (cogsCents > 0) {
    const cogs = await postJournal(tx, actor, {
      date: issuedOn,
      memo: `Cost of ${invoice.number}`,
      source: "COGS",
      sourceId: invoice.id,
      lines: cogsJournal(cogsCents),
      isExample: delivery.isExample,
    });
    if (!cogs.ok) return cogs;
    cogsId = cogs.value;
  }
  await tx.invoice.update({
    where: { id: invoice.id },
    data: { salesJournalId: sales.value, cogsJournalId: cogsId },
  });
  await audit(tx, actor, "invoice", "Invoice", invoice.id, `Created invoice ${invoice.number} from ${delivery.number}.`);
  return ok({ invoiceId: invoice.id });
}

export async function payInvoice(
  actor: Actor,
  input: { invoiceId: string; amountCents: number; paidOn: Date; method: string; reference: string },
): Promise<Result<{ paymentId: string }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { party: true } });
    if (!invoice) return err("That invoice was not found.");
    if (!input.method.trim() || !input.reference.trim()) return err("Enter how they paid and a reference, such as a check number.");
    if (invoice.status === "VOID") return err("This invoice was voided. Its number stays on file and cannot be paid.");
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return err("Enter a payment greater than zero.");
    if (input.amountCents > invoice.balanceCents) return err("That payment is more than the open balance.");
    const settlement = applyEarlyPay({
      goodsNetCents: invoice.goodsNetCents,
      earlyPayBps: invoice.earlyPayBps,
      earlyPayDays: invoice.earlyPayDays,
      issuedOn: toDateInput(invoice.issuedOn),
      paidOn: toDateInput(input.paidOn),
      balanceCents: invoice.balanceCents,
      cashCents: input.amountCents,
    });
    const payment = await tx.customerPayment.create({
      data: {
        number: await nextNumber(tx, "receipt-pay"),
        partyId: invoice.partyId,
        paidOn: input.paidOn,
        amountCents: input.amountCents,
        method: input.method.trim(),
        reference: input.reference.trim(),
        notes: settlement.message,
        isExample: invoice.isExample,
        applications: {
          create: { invoiceId: invoice.id, amountCents: input.amountCents, discountCents: settlement.discountCents },
        },
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        balanceCents: settlement.openCents,
        earlyTakenCents: invoice.earlyTakenCents + settlement.discountCents,
        status: settlement.openCents === 0 ? "PAID" : "PARTIAL",
      },
    });
    const journalLines: DraftLine[] = [
      { accountCode: CODES.cash, debitCents: input.amountCents, creditCents: 0, memo: "Customer payment" },
      { accountCode: CODES.ar, debitCents: 0, creditCents: settlement.arReliefCents, memo: `Payment on ${invoice.number}` },
    ];
    if (settlement.discountCents > 0) {
      journalLines.push({
        accountCode: CODES.salesDiscount,
        debitCents: settlement.discountCents,
        creditCents: 0,
        memo: "Early-payment discount",
      });
    }
    const journal = await postJournal(tx, actor, {
      date: input.paidOn,
      memo: `Payment ${payment.number} on ${invoice.number}`,
      source: "CUSTOMER_PAYMENT",
      sourceId: payment.id,
      lines: journalLines,
      isExample: invoice.isExample,
    });
    if (!journal.ok) return journal;
    await tx.customerPayment.update({ where: { id: payment.id }, data: { journalId: journal.value } });
    await audit(tx, actor, "pay", "CustomerPayment", payment.id, `Recorded ${payment.number} from ${invoice.party.name}.`);
    return ok({ paymentId: payment.id });
  });
}

export async function createDirectOrder(
  actor: Actor,
  input: {
    partyId: string;
    orderedOn: Date;
    customerPo: string;
    notes: string;
    lines: LineInput[];
    channel?: Channel;
    isExample?: boolean;
  },
): Promise<Result<{ orderId: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run(async (tx) => {
    const party = await tx.party.findUnique({ where: { id: input.partyId } });
    if (!party?.isCustomer || !party.active) return err("Choose an active customer.");
    const priced: { productId: string; description: string; qty: number; unitPriceCents: number }[] = [];
    for (const line of input.lines.filter((item) => item.qty > 0)) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product) return err("One of the products was not found.");
      const block = sellBlockReason({
        active: product.active,
        sellable: product.sellable,
        priceStatus: product.priceStatus,
        listPrice: product.listPrice == null ? null : Number(product.listPrice),
      });
      if (block && input.channel !== "AMAZON") return err(`${product.name}: ${block}`);
      const price = line.specialPrice ?? (product.listPrice == null ? null : Number(product.listPrice));
      if (price == null) return err(`${product.name} needs a price.`);
      const priceProblem = buyPriceProblem(price, Boolean(product.allowOneDollar));
      if (priceProblem) return err(`${product.name}: ${priceProblem}`);
      priced.push({ productId: product.id, description: product.name, qty: line.qty, unitPriceCents: Math.round(price * 100) });
    }
    if (priced.length === 0) return err("Add at least one line.");
    const order = await tx.salesOrder.create({
      data: {
        number: await nextNumber(tx, "order"),
        partyId: party.id,
        orderedOn: input.orderedOn,
        shipStreet: party.shipStreet,
        shipCity: party.shipCity,
        shipState: party.shipState || party.billState,
        shipZip: party.shipZip,
        taxLocality: party.taxLocality,
        customerPo: input.customerPo,
        notes: input.notes,
        isExample: input.isExample ?? false,
        lines: { create: priced.map((line, index) => ({ ...line, sort: index })) },
      },
    });
    await audit(tx, actor, "create", "SalesOrder", order.id, `Created order ${order.number} for ${party.name}.`);
    return ok({ orderId: order.id });
  });
}

export async function createAmazonSale(
  actor: Actor,
  input: {
    partyId: string;
    orderId: string;
    date: Date;
    productId: string;
    qty: number;
    itemPriceCents: number;
    feeCents: number;
  },
): Promise<Result<{ invoiceId: string }>> {
  const denied = deny(actor, "importData");
  if (denied) return denied;
  return run(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) return err("That product was not found.");
    const party = await tx.party.findUnique({ where: { id: input.partyId } });
    if (!party) return err("That customer was not found.");
    const existing = await tx.invoice.findFirst({
      where: { channel: party.channel, marketplaceOrderId: input.orderId, status: { not: "VOID" } },
    });
    if (existing) return err(`Marketplace order ${input.orderId} is already invoice ${existing.number}.`);
    const unit = Math.round(input.itemPriceCents / input.qty);
    if (Math.round(input.qty * unit) !== input.itemPriceCents) {
      return err(`Amazon order ${input.orderId}: the item price does not divide into a whole-cent unit price.`);
    }
    const order = await tx.salesOrder.create({
      data: {
        number: await nextNumber(tx, "order"),
        partyId: input.partyId,
        orderedOn: input.date,
        customerPo: input.orderId,
        notes: party.channel === "WALMART" ? "Walmart order." : "Amazon order.",
        lines: {
          create: [{
            productId: product.id,
            description: product.name,
            qty: input.qty,
            unitPriceCents: unit,
            sort: 0,
          }],
        },
      },
    });
    const shipped = await shipOrderTx(tx, actor, {
      orderId: order.id,
      shipAll: true,
      shippedOn: input.date,
      carrier: "Amazon",
      tracking: input.orderId,
      notes: "Amazon import",
    });
    if (!shipped.ok) return err(`Amazon order ${input.orderId}: ${shipped.error}`);
    const invoiced = await invoiceDeliveryTx(tx, actor, shipped.value.deliveryId, input.date, input.feeCents);
    if (!invoiced.ok) return err(`Amazon order ${input.orderId}: ${invoiced.error}`);
    return invoiced;
  });
}

export async function reviseQuote(actor: Actor, quoteId: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run(async (tx) => {
    const quote = await tx.quote.findUnique({ where: { id: quoteId }, include: { lines: true } });
    if (!quote) return err("That quote was not found.");
    if (quote.status === "ACCEPTED") return err("This revision was accepted. Change the order instead.");
    if (quote.status === "SUPERSEDED") return err("Open the latest revision.");
    const revision = nextRevision(quote.revision);
    if (!revision) return err("This quote has used every revision letter.");
    const created = await tx.quote.create({
      data: {
        number: quote.number,
        revision,
        partyId: quote.partyId,
        issuedOn: quote.issuedOn,
        validUntil: quote.validUntil,
        shipStreet: quote.shipStreet,
        shipCity: quote.shipCity,
        shipState: quote.shipState,
        shipZip: quote.shipZip,
        taxLocality: quote.taxLocality,
        notes: quote.notes,
        incoterm: quote.incoterm,
        namedPlace: quote.namedPlace,
        currency: quote.currency,
        creditTerm: quote.creditTerm,
        customNetDays: quote.customNetDays,
        earlyPayBps: quote.earlyPayBps,
        earlyPayDays: quote.earlyPayDays,
        freightCents: quote.freightCents,
        insuranceCents: quote.insuranceCents,
        docDiscountKind: quote.docDiscountKind,
        docDiscountValue: quote.docDiscountValue,
        discountCents: quote.discountCents,
        goodsNetCents: quote.goodsNetCents,
        subtotalCents: quote.subtotalCents,
        taxCents: quote.taxCents,
        totalCents: quote.totalCents,
        isExample: quote.isExample,
        lines: {
          create: quote.lines.map((line) => ({
            productId: line.productId,
            description: line.description,
            qty: line.qty,
            unitPriceCents: line.unitPriceCents,
            discountKind: line.discountKind,
            discountValue: line.discountValue,
            discountCents: line.discountCents,
            priceSource: line.priceSource,
            sort: line.sort,
          })),
        },
      },
    });
    await tx.quote.update({ where: { id: quote.id }, data: { status: "SUPERSEDED" } });
    await audit(tx, actor, "revise", "Quote", created.id, `Created ${quoteLabel(created.number, created.revision)}.`);
    return ok({ id: created.id });
  });
}

export async function voidInvoice(actor: Actor, invoiceId: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "sell");
  if (denied) return denied;
  return run(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { applications: true } });
    if (!invoice) return err("That invoice was not found.");
    if (invoice.status === "VOID") return err(`${invoice.number} is already void. The number is not reused.`);
    if (invoice.applications.length > 0) return err("Take the payment off before voiding this invoice.");
    const reverse = async (journalId: string | null, memo: string) => {
      if (!journalId) return null;
      const lines = await tx.journalLine.findMany({ where: { entryId: journalId }, include: { account: true } });
      const posted = await postJournal(tx, actor, {
        date: new Date(),
        memo,
        source: "VOID",
        sourceId: invoice.id,
        lines: lines.map((line) => ({
          accountCode: line.account.code,
          debitCents: line.creditCents,
          creditCents: line.debitCents,
          memo: `Void ${invoice.number}`,
        })),
        isExample: invoice.isExample,
      });
      if (!posted.ok) return posted.error;
      return null;
    };
    const salesError = await reverse(invoice.salesJournalId, `Void ${invoice.number}`);
    if (salesError) return err(salesError);
    const cogsError = await reverse(invoice.cogsJournalId, `Void cost of ${invoice.number}`);
    if (cogsError) return err(cogsError);
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOID", balanceCents: 0 } });
    await audit(tx, actor, "void", "Invoice", invoice.id, `Voided ${invoice.number}. The number stays on file.`);
    return ok({ id: invoice.id });
  });
}
