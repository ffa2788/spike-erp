import { describe, expect, it } from "vitest";
import { parseWalmartOrders, walmartConnection } from "@/lib/walmart";
import {
  applyEarlyPay,
  channelPrefix,
  discountCents,
  earlyPayOffer,
  formatInvoiceNumber,
  nextRevision,
  priceLines,
  quoteLabel,
  resolveUnitPrice,
  termCharges,
  termsLabel,
} from "@/lib/commercial";

describe("discount math", () => {
  it("applies a line percent, a line amount, and a document percent without going past the goods", () => {
    const priced = priceLines({
      lines: [
        { qty: 10, unitPriceCents: 1000, taxable: true, discountKind: "PERCENT", discountValue: 1000 },
        { qty: 2, unitPriceCents: 5000, taxable: false, discountKind: "AMOUNT", discountValue: 1500 },
      ],
      docKind: "PERCENT",
      docValue: 500,
    });
    expect("error" in priced).toBe(false);
    if ("error" in priced) return;
    expect(priced.lines[0]).toMatchObject({ extendedCents: 10000, lineDiscountCents: 1000, netCents: 9000 });
    expect(priced.lines[1]).toMatchObject({ extendedCents: 10000, lineDiscountCents: 1500, netCents: 8500 });
    expect(priced.docDiscountCents).toBe(Math.round(17500 * 0.05));
    expect(priced.goodsNetCents).toBe(17500 - priced.docDiscountCents);
    expect(priced.lines.reduce((sum, line) => sum + line.docShareCents, 0)).toBe(priced.docDiscountCents);
    expect(priced.lines.reduce((sum, line) => sum + line.afterDocCents, 0)).toBe(priced.goodsNetCents);
  });

  it("does not discount more than the line", () => {
    expect(discountCents(1000, "AMOUNT", 5000)).toBe(1000);
    expect(discountCents(1000, "PERCENT", 10000)).toBe(1000);
    expect(discountCents(1000, "NONE", 500)).toBe(0);
  });

  it("uses the customer level, then the volume break that the quantity reaches", () => {
    const breaks = [
      { minQty: 10, unitPriceCents: 200 },
      { minQty: 50, unitPriceCents: 180 },
    ];
    expect(resolveUnitPrice({ qty: 4, listCents: 240, levelCents: 220, breaks }).source).toBe("Customer price level");
    expect(resolveUnitPrice({ qty: 12, listCents: 240, levelCents: 220, breaks }).unitPriceCents).toBe(200);
    expect(resolveUnitPrice({ qty: 50, listCents: 240, levelCents: null, breaks }).unitPriceCents).toBe(180);
    expect(resolveUnitPrice({ qty: 1, listCents: 240, levelCents: null, breaks: [] }).source).toBe("List price");
  });
});

describe("early payment", () => {
  const base = {
    goodsNetCents: 10000,
    earlyPayBps: 200,
    earlyPayDays: 10,
    issuedOn: "2026-11-01",
    balanceCents: 10700,
  };

  it("offers 2/10 on the goods only and applies it when the reduced amount is paid in time", () => {
    const offer = earlyPayOffer({ ...base, asOf: "2026-11-10" });
    expect(offer.available).toBe(true);
    expect(offer.discountCents).toBe(200);
    expect(offer.payCents).toBe(10500);
    expect(offer.deadline).toBe("2026-11-11");
    const taken = applyEarlyPay({ ...base, paidOn: "2026-11-10", cashCents: 10500 });
    expect(taken.discountCents).toBe(200);
    expect(taken.openCents).toBe(0);
    expect(applyEarlyPay({ ...base, paidOn: "2026-11-12", cashCents: 10500 }).discountCents).toBe(0);
    expect(applyEarlyPay({ ...base, paidOn: "2026-11-10", cashCents: 10700 }).discountCents).toBe(0);
    expect(applyEarlyPay({ ...base, paidOn: "2026-11-10", cashCents: 5000 }).discountCents).toBe(0);
  });

  it("labels 2/10 Net 30", () => {
    expect(termsLabel({ term: "NET_30", customNetDays: 30, earlyPayBps: 200, earlyPayDays: 10 })).toBe("2/10 Net 30");
  });
});

describe("incoterms, revisions, and invoice numbers", () => {
  it("charges freight and insurance only when the 2020 term puts them on the seller", () => {
    expect(termCharges("EXW")).toMatchObject({ sellerFreight: false, sellerInsurance: false });
    expect(termCharges("CFR")).toMatchObject({ sellerFreight: true, sellerInsurance: false });
    expect(termCharges("CIF")).toMatchObject({ sellerFreight: true, sellerInsurance: true });
    expect(termCharges("CIP")).toMatchObject({ sellerFreight: true, sellerInsurance: true });
    expect(termCharges("DDP").sellerInsurance).toBe(false);
  });

  it("keeps quote revisions and separate channel numbers", () => {
    expect(nextRevision("A")).toBe("B");
    expect(nextRevision("Z")).toBeNull();
    expect(quoteLabel("Q-0001", "B")).toBe("Q-0001 rev B");
    expect(formatInvoiceNumber("DIRECT", 1)).toBe("S-000001");
    expect(formatInvoiceNumber("AMAZON", 1)).toBe("A-000001");
    expect(formatInvoiceNumber("WALMART", 2)).toBe("W-000002");
    expect(channelPrefix("MUNICIPAL")).toBe("S");
    expect(channelPrefix("EXPORT")).toBe("E");
  });

  it("leaves Walmart disconnected until both credentials exist and does not invent orders", () => {
    expect(walmartConnection({}).connected).toBe(false);
    expect(walmartConnection({ WALMART_CLIENT_ID: "id", WALMART_CLIENT_SECRET: "secret" }).connected).toBe(true);
    expect(parseWalmartOrders(JSON.stringify({ list: { elements: { order: [] } } }))).toEqual([]);
    const rows = parseWalmartOrders(JSON.stringify({
      list: { elements: { order: [{ purchaseOrderId: "PO1", orderLines: { orderLine: [{ item: { sku: "POLY-LIQ" }, orderLineQuantity: { amount: "2" }, charges: { charge: [{ chargeAmount: { amount: 12.4 } }] } }] } }] } },
    }));
    expect(rows).toEqual([{ orderId: "PO1", sku: "POLY-LIQ", qty: 2, itemPriceCents: 1240 }]);
  });
});
