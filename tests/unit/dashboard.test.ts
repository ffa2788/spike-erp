import { describe, expect, it } from "vitest";
import { comparePeriods, executiveDashboard, marginPercent, upcomingTaxDeadlines } from "@/lib/dashboard";

const asOf = "2026-11-14";

describe("executive dashboard", () => {
  const invoices = [
    {
      issuedOn: "2026-11-03",
      channel: "MUNICIPAL",
      partyName: "City",
      subtotalCents: 10000,
      lines: [{ productId: "p1", productName: "Beads", amountCents: 10000, cogsCents: 4000 }],
    },
    {
      issuedOn: "2026-10-05",
      channel: "AMAZON",
      partyName: "Amazon",
      subtotalCents: 5000,
      lines: [{ productId: "p2", productName: "Liquid", amountCents: 5000, cogsCents: 1000 }],
    },
    {
      issuedOn: "2026-02-02",
      channel: "WALMART",
      partyName: "Walmart",
      subtotalCents: 2000,
      lines: [{ productId: "p1", productName: "Beads", amountCents: 2000, cogsCents: 500 }],
    },
  ];

  it("compares this month and this year with the prior period, by channel", () => {
    const dash = executiveDashboard({
      asOf,
      entity: "S_CORP",
      invoices,
      quotes: [
        { status: "DRAFT", totalCents: 55500 },
        { status: "SENT", totalCents: 1000 },
        { status: "ACCEPTED", totalCents: 9000 },
      ],
      receivables: [
        { balanceCents: 15248, due: "2026-11-01" },
        { balanceCents: 5000, due: "2026-12-01" },
      ],
      payables: [
        { balanceCents: 92000, due: "2026-11-20" },
        { balanceCents: 100, due: "2026-12-20" },
      ],
      cashCents: 7_563_000,
      unreconciled: 3,
      inventoryCents: 1_508_265,
      belowReorder: 2,
      criticalCoverage: 4,
      lowCoverage: 1,
      ordersToShip: 1,
      uninvoicedDeliveries: 2,
    });
    expect(dash.mtd.salesCents).toBe(10000);
    expect(dash.mtd.versus.percent).toBe(100);
    expect(dash.ytd.salesCents).toBe(17000);
    expect(dash.channels.map((row) => [row.code, row.salesCents])).toEqual([
      ["S", 10000],
      ["A", 5000],
      ["W", 2000],
    ]);
    expect(dash.marginPercent).toBe(marginPercent(17000, 5500));
    expect(dash.marginPercent).toBe(67.6);
    expect(dash.quoteCount).toBe(2);
    expect(dash.pipelineCents).toBe(56500);
    expect(dash.overdueCents).toBe(15248);
    expect(dash.aging.current).toBe(5000);
    expect(dash.payablesSoonCents).toBe(92000);
    expect(dash.payablesSoonCount).toBe(1);
    expect(dash.topProducts[0]).toMatchObject({ name: "Beads", salesCents: 12000, marginCents: 7500 });
    expect(dash.topCustomers[0].name).toBe("City");
    expect(dash.ordersToShip).toBe(1);
    expect(dash.uninvoicedDeliveries).toBe(2);
    expect(comparePeriods(0, 0).words).toMatch(/No sales/);
  });

  it("lists the next Florida, 1099, and corporate dates", () => {
    const dates = upcomingTaxDeadlines("2026-11-14", "S_CORP");
    expect(dates.map((row) => row.date)).toEqual(["2026-11-20", "2027-01-31", "2027-03-15"]);
    expect(upcomingTaxDeadlines("2026-11-21", "C_CORP")[0].date).toBe("2026-12-20");
    expect(upcomingTaxDeadlines("2026-03-20", "S_CORP").find((row) => row.name.startsWith("Form"))?.date).toBe("2027-03-15");
    expect(upcomingTaxDeadlines("2026-02-01", "C_CORP").find((row) => row.name === "Form 1120")?.date).toBe("2026-04-15");
  });
});
