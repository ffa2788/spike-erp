import { describe, expect, it } from "vitest";
import { channelSales, customerSales, numberGaps, periodWindow, productSales, profitStatement } from "@/lib/owner-reports";
import { presentProfit, statementMoney, statementTitle } from "@/lib/pnl-present";

describe("owner reports", () => {
  it("compares a month with the month before it, and a week with the week before it", () => {
    const month = periodWindow({ kind: "month", anchor: "2026-10-15" });
    expect(month).toMatchObject({ from: "2026-10-01", to: "2026-10-31", priorFrom: "2026-09-01", priorTo: "2026-09-30" });
    const week = periodWindow({ kind: "week", anchor: "2026-10-14" });
    expect(week.from).toBe("2026-10-12");
    expect(week.to).toBe("2026-10-18");
    expect(week.priorTo).toBe("2026-10-11");
  });

  it("splits Amazon into FBA and FBM and shows the change from the prior period", () => {
    const rows = channelSales(
      [
        { channel: "AMAZON", fulfillment: "FBA", cents: 5500 },
        { channel: "AMAZON", fulfillment: "FBM", cents: 2000 },
        { channel: "DIRECT", fulfillment: "WAREHOUSE", cents: 1000 },
      ],
      [{ channel: "AMAZON", fulfillment: "FBA", cents: 1000 }],
    );
    expect(rows.find((row) => row.name === "Amazon FBA")).toMatchObject({ currentCents: 5500, priorCents: 1000, deltaCents: 4500 });
    expect(rows.find((row) => row.name === "Amazon FBM")?.currentCents).toBe(2000);
    expect(rows.find((row) => row.name === "Direct")?.currentCents).toBe(1000);
  });

  it("computes product margin and customer AR", () => {
    const products = productSales([
      { id: "a", name: "Jug", qty: 2, revenueCents: 10000, cogsCents: 4000 },
      { id: "a", name: "Jug", qty: 1, revenueCents: 5000, cogsCents: 2000 },
    ]);
    expect(products[0]).toMatchObject({ qty: 3, revenueCents: 15000, cogsCents: 6000, marginCents: 9000, marginPercent: 60 });
    const customers = customerSales([
      { name: "City", revenueCents: 10000, cogsCents: 4000, balanceCents: 10000 },
      { name: "City", revenueCents: 5000, cogsCents: 2000, balanceCents: 0 },
    ]);
    expect(customers[0]).toMatchObject({ invoices: 2, revenueCents: 15000, marginCents: 9000, arCents: 10000 });
  });

  it("builds a profit statement from channel revenue, returns, cost, and expenses", () => {
    const lines = profitStatement({
      revenue: [{ name: "Direct", month: 10000, prior: 8000, ytd: 20000 }],
      returns: { month: 500, prior: 0, ytd: 500 },
      discounts: { month: 200, prior: 0, ytd: 200 },
      cogs: { month: 4000, prior: 3000, ytd: 7000 },
      expenses: [{ name: "Rent", month: 1000, prior: 1000, ytd: 3000 }],
      otherIncome: { month: 100, prior: 0, ytd: 100 },
    });
    expect(lines.find((line) => line.label === "Net revenue")).toMatchObject({ month: 9300 });
    expect(lines.find((line) => line.label === "Gross profit")).toMatchObject({ month: 5300 });
    expect(lines.find((line) => line.label === "Net income")).toMatchObject({ month: 4400, prior: 4000, ytd: 9400 });
    const shown = presentProfit(lines);
    expect(shown.find((row) => row.label === "Net income")).toMatchObject({ month: 4400, prior: 4000, ytd: 9400 });
    expect(statementMoney(-860456, true)).toBe("($8,604.56)");
    expect(statementMoney(1254100, false)).toBe("12,541.00");
    expect(statementTitle("2026-10-01", "2026-10-31")).toBe("October 1 – 31, 2026");
  });

  it("finds a missing invoice number and ignores a solid run", () => {
    expect(numberGaps(["S-000001", "S-000002", "S-000004"])).toEqual([3]);
    expect(numberGaps(["A-000001", "A-000002", "A-000003"])).toEqual([]);
  });
});
