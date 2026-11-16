import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { journalProblem } from "@/lib/journals";
import {
  PAYMENT_HEADERS,
  dedupePayments,
  feeRowJournal,
  netMarginCents,
  parseAmazonMoney,
  parsePaymentsReport,
  paymentDay,
  refundJournal,
  rollupPaymentFees,
  settlementJournal,
  storedPayment,
  transferJournal,
} from "@/lib/amazon-payments";

const file = readFileSync("tests/fixtures/amazon-payments.csv", "utf8");

describe("Amazon payments date range", () => {
  it("finds the date/time header after the preamble and reads comma amounts", () => {
    expect(file.charCodeAt(0)).toBe(0xfeff);
    for (const header of PAYMENT_HEADERS) expect(file).toContain(header);
    expect(parseAmazonMoney("-$1,234.56")).toBe(-123456);
    expect(paymentDay("Nov 2, 2026 9:15:00 AM PST")).toBe("2026-11-02");
    const parsed = parsePaymentsReport(file);
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(12);
    expect(JSON.stringify(parsed.rows)).not.toContain("33602");
    const transfer = parsed.rows.find((row) => row.type === "Transfer");
    expect(transfer?.totalCents).toBe(-123456);
    expect(storedPayment(transfer!).totalCents).toBe(-123456);
    expect(JSON.stringify(storedPayment(transfer!))).not.toContain("33602");
    const kept = dedupePayments(parsed.rows);
    expect(kept.duplicates).toBe(1);
    expect(kept.kept).toHaveLength(11);
    const overlapped = dedupePayments([...parsed.rows, ...parsed.rows]);
    expect(overlapped.kept).toHaveLength(11);
    expect(overlapped.duplicates).toBe(13);
    const types = new Set(kept.kept.map((row) => row.type));
    for (const type of ["Order", "Shipping Services", "Adjustment", "Refund", "Service Fee", "FBA Transaction fees", "Transfer", "FBA Inventory Fee", "Chargeback Refund"]) {
      expect(types.has(type)).toBe(true);
    }
  });

  it("averages referral and FBA fees and allocates the shared costs", () => {
    const { kept } = dedupePayments(parsePaymentsReport(file).rows);
    const rows = rollupPaymentFees(kept);
    const preventer = rows.find((row) => row.sku === "SC-RP1-1.0-1");
    const space = rows.find((row) => row.sku === "SC-RP1-1.0-1 -FBA");
    const remover = rows.find((row) => row.sku === "SPER-RR-1.0-1-FBA");
    expect(preventer).toMatchObject({
      orderUnits: 2,
      refundUnits: 1,
      netUnits: 1,
      productSalesCents: 1600,
      avgSellingFeePerUnitCents: 240,
      avgFbaFeePerUnitCents: 320,
      shippingCents: 0,
      serviceCents: 1729,
      storageCents: 137,
      otherAllocatedCents: 22,
      feeExpenseCents: 2548,
    });
    expect(space).toMatchObject({
      netUnits: 1,
      productSalesCents: 2400,
      avgSellingFeePerUnitCents: 360,
      avgFbaFeePerUnitCents: 320,
      serviceCents: 1297,
      storageCents: 103,
      feeExpenseCents: 2096,
    });
    expect(remover).toMatchObject({
      shippingCents: 450,
      serviceCents: 973,
      storageCents: 0,
      refundSalesCents: -500,
      productSalesCents: 1300,
      avgSellingFeePerUnitCents: 270,
      avgFbaFeePerUnitCents: 0,
      feeExpenseCents: 1630,
    });
    expect(netMarginCents(preventer!, 1000)).toEqual({ costCents: 1000, marginCents: 1600 - 2548 - 1000 });
    expect(netMarginCents(remover!, 800).marginCents).toBe(1300 - 1630);
  });

  it("builds balanced journals for a settlement, a payout, and a refund", () => {
    const settlement = settlementJournal({ invoiceBalanceCents: 3200, orderTotalCents: 2080 });
    const payout = transferJournal(-123456);
    const refund = refundJournal({
      dateTime: "",
      day: "",
      settlementId: "",
      type: "Refund",
      orderId: "111-0000001-0000001",
      sku: "SC-RP1-1.0-1",
      description: "",
      qty: 1,
      fulfillment: "Amazon",
      channel: "FBA",
      productSalesCents: -1600,
      sellingFeeCents: 240,
      fbaFeeCents: 320,
      otherTransactionFeeCents: 0,
      otherCents: 0,
      promotionalRebatesCents: 0,
      totalCents: -1040,
    });
    expect(journalProblem(settlement!)).toBeNull();
    expect(journalProblem(payout!)).toBeNull();
    expect(journalProblem(refund!)).toBeNull();
    expect(journalProblem(feeRowJournal(-3999)!)).toBeNull();
    expect(payout?.[0].debitCents).toBe(123456);
  });
});
