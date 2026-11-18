import { describe, expect, it } from "vitest";
import { amazonFeeAccount, feeJournal, settlementNetsToDeposit, type PaymentRow } from "@/lib/amazon-payments";
import { CODES } from "@/lib/chart";
import { journalProblem } from "@/lib/journals";

function row(partial: Partial<PaymentRow>): PaymentRow {
  return {
    dateTime: "2026-11-02",
    day: "2026-11-02",
    settlementId: "SYNTH-1",
    type: "Order",
    orderId: "111-1",
    sku: "SC-RP1-1.0-1",
    description: "",
    qty: 1,
    fulfillment: "Amazon",
    channel: "FBA",
    productSalesCents: 0,
    sellingFeeCents: 0,
    fbaFeeCents: 0,
    otherTransactionFeeCents: 0,
    otherCents: 0,
    promotionalRebatesCents: 0,
    totalCents: 0,
    ...partial,
  };
}

describe("Amazon fees and the deposit", () => {
  it("books each fee type to its own account, including the FBM shipping label", () => {
    expect(amazonFeeAccount("Shipping Services", "label")).toBe(CODES.amazonShipping);
    expect(amazonFeeAccount("Service Fee", "Subscription")).toBe(CODES.amazonSubscription);
    expect(amazonFeeAccount("FBA Inventory Fee", "storage")).toBe(CODES.amazonStorage);
    expect(amazonFeeAccount("Service Fee", "Cost of Advertising")).toBe(CODES.amazonAds);
    expect(amazonFeeAccount("Order", "FBAPerUnitFulfillmentFee")).toBe(CODES.amazonFbaFee);
    expect(amazonFeeAccount("Order", "Commission")).toBe(CODES.amazonReferral);
    const label = feeJournal(-450, CODES.amazonShipping, "Amazon shipping label 111-1");
    expect(label?.[0].accountCode).toBe(CODES.amazonShipping);
    expect(journalProblem(label!)).toBeNull();
  });

  it("requires the settlement activity to equal the deposit", () => {
    const rows = [
      row({ productSalesCents: 3200, sellingFeeCents: -480, fbaFeeCents: -640, totalCents: 2080 }),
      row({ type: "Shipping Services", orderId: "111-2", description: "label", totalCents: -450, channel: "FBM", fulfillment: "Merchant" }),
      row({ type: "Refund", productSalesCents: -1600, totalCents: -1040 }),
      row({ type: "Transfer", settlementId: "SYNTH-1", totalCents: -590, orderId: "" }),
    ];
    const [tie] = settlementNetsToDeposit(rows);
    expect(tie.activityCents).toBe(2080 - 450 - 1040);
    expect(tie.depositCents).toBe(590);
    expect(tie.differenceCents).toBe(0);
  });
});
