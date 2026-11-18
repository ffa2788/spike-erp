import { describe, expect, it } from "vitest";
import { parseSettlementFlatFile, readAmazonMoneyFile } from "@/lib/amazon-payments";
import { reconcileAmazonPeriod } from "@/lib/amazon-reconcile";

const flat = [
  "settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tmerchant-order-id\tadjustment-id\tshipment-id\tmarketplace-name\tamount-type\tamount-description\tamount\tfulfillment-id\tposted-date\tposted-date-time\torder-item-code\tmerchant-order-item-id\tmerchant-adjustment-item-id\tsku\tquantity-purchased\tpromotion-id",
  "SYNTH-1\t2026-11-01\t2026-11-14\t2026-11-14\t20.80\tUSD\tOrder\t111-0000001-0000001\t\t\t\tAmazon.com\tItemPrice\tPrincipal\t32.00\tAFN\t2026-11-02\t2026-11-02T09:15:00Z\t1001\t\t\tSC-RP1-1.0-1\t2\t",
  "SYNTH-1\t2026-11-01\t2026-11-14\t2026-11-14\t20.80\tUSD\tOrder\t111-0000001-0000001\t\t\t\tAmazon.com\tItemFees\tCommission\t-4.80\tAFN\t2026-11-02\t2026-11-02T09:15:00Z\t1001\t\t\tSC-RP1-1.0-1\t2\t",
  "SYNTH-1\t2026-11-01\t2026-11-14\t2026-11-14\t20.80\tUSD\tOrder\t111-0000001-0000001\t\t\t\tAmazon.com\tItemFees\tFBAPerUnitFulfillmentFee\t-6.40\tAFN\t2026-11-02\t2026-11-02T09:15:00Z\t1001\t\t\tSC-RP1-1.0-1\t2\t",
  "SYNTH-1\t2026-11-01\t2026-11-14\t2026-11-14\t-10.40\tUSD\tRefund\t111-0000001-0000001\t\t\t\tAmazon.com\tItemPrice\tPrincipal\t-16.00\tAFN\t2026-11-06\t2026-11-06T13:00:00Z\t1001\t\t\tSC-RP1-1.0-1\t1\t",
  "SYNTH-1\t2026-11-01\t2026-11-14\t2026-11-14\t10.40\tUSD\tTransfer\t\t\t\t\tAmazon.com\tother-transaction\tCurrent Reserve Amount\t-10.40\t\t2026-11-14\t2026-11-14T06:00:00Z\t\t\t\t\t\t",
].join("\n");

describe("Amazon settlement flat file and reconciliation", () => {
  it("reads a settlement flat file as the same rows as the payments report", () => {
    const parsed = readAmazonMoneyFile(flat);
    expect(parsed.kind).toBe("settlement");
    expect(parsed.error).toBeNull();
    const order = parsed.rows.find((row) => row.type === "Order");
    expect(order?.productSalesCents).toBe(3200);
    expect(order?.sellingFeeCents).toBe(-480);
    expect(order?.fbaFeeCents).toBe(-640);
    expect(order?.channel).toBe("FBA");
    expect(parsed.rows.find((row) => row.type === "Refund")?.productSalesCents).toBe(-1600);
    expect(parsed.rows.find((row) => row.type === "Transfer")?.totalCents).toBe(-1040);
    expect(parseSettlementFlatFile("nope").error).toBeTruthy();
  });

  it("lists a missing order, an unmapped SKU, and a payout that matches", () => {
    const report = reconcileAmazonPeriod({
      period: "2026-11",
      orders: [
        { orderId: "111-1", sku: "SC-RP1-1.0-1", purchaseDate: "2026-11-02", shipped: true, cancelled: false, netCents: 3200, productId: "gal", fulfillment: "FBA" },
        { orderId: "111-4", sku: "B0CTQ1TFCT.missing01", purchaseDate: "2026-11-05", shipped: true, cancelled: false, netCents: 1200, productId: null, fulfillment: "FBA" },
      ],
      invoices: [
        { number: "A-000001", marketplaceOrderId: "111-1", totalCents: 3200, balanceCents: 0, issuedOn: "2026-11-02" },
      ],
      lines: [
        { settlementId: "SYNTH-1", type: "Order", orderId: "111-1", sku: "SC-RP1-1.0-1", day: "2026-11-02", productSalesCents: 3200, sellingFeeCents: -480, fbaFeeCents: -640, otherCents: 0, otherTransactionFeeCents: 0, totalCents: 2080 },
        { settlementId: "SYNTH-1", type: "Refund", orderId: "111-1", sku: "SC-RP1-1.0-1", day: "2026-11-06", productSalesCents: -1600, sellingFeeCents: 240, fbaFeeCents: 320, otherCents: 0, otherTransactionFeeCents: 0, totalCents: -1040 },
        { settlementId: "SYNTH-1", type: "Transfer", orderId: "", sku: "", day: "2026-11-14", productSalesCents: 0, sellingFeeCents: 0, fbaFeeCents: 0, otherCents: 0, otherTransactionFeeCents: 0, totalCents: -1040 },
      ],
    });
    expect(report.grossSalesCents).toBe(3200);
    expect(report.refundCount).toBe(1);
    expect(report.depositCents).toBe(1040);
    expect(report.differences.map((row) => row.kind)).toContain("unmapped SKU");
    expect(report.differences.map((row) => row.kind)).not.toContain("missing order");
    expect(report.differences.map((row) => row.kind)).not.toContain("payout");
  });
});
