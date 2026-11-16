import { describe, expect, it } from "vitest";
import { independentDemand, orderQty, runMrp, type MrpItem } from "@/lib/mrp";
import { coverItem } from "@/lib/coverage";
import { stockAlerts } from "@/lib/alerts";
import { emailSetup } from "@/lib/email";

const asOf = "2026-11-14";

function item(partial: Partial<MrpItem> & Pick<MrpItem, "id" | "kind">): MrpItem {
  return {
    name: partial.id,
    unit: "lb",
    leadTimeDays: 0,
    reorderPoint: 0,
    safetyQty: 0,
    maxQty: 0,
    moq: 0,
    multiple: 0,
    onHandReleased: 0,
    onHandQuarantine: 0,
    make: partial.kind === "FINISHED",
    ...partial,
  };
}

describe("MRP netting", () => {
  it("explodes a sub-recipe and a packaging bill, and ignores quarantine", () => {
    const items = [
      item({ id: "pack", kind: "FINISHED", make: true, leadTimeDays: 0, unit: "each" }),
      item({ id: "blend", kind: "FINISHED", make: true, leadTimeDays: 7 }),
      item({ id: "raw", kind: "RAW", make: false, leadTimeDays: 14, safetyQty: 10, moq: 25, multiple: 5 }),
      item({ id: "jug", kind: "PACKAGING", make: false, leadTimeDays: 7, onHandQuarantine: 100 }),
    ];
    const result = runMrp({
      asOf,
      items,
      bom: [
        { parentId: "pack", componentId: "blend", qtyPer: 10 },
        { parentId: "pack", componentId: "jug", qtyPer: 1 },
        { parentId: "blend", componentId: "raw", qtyPer: 1 },
      ],
      independent: [{ itemId: "pack", date: "2026-11-21", qty: 4, channel: "S", source: "ORDER" }],
      openSupply: [],
    });
    expect(result.error).toBeNull();
    expect(result.gross.get("blend")?.reduce((sum, qty) => sum + qty, 0)).toBe(40);
    expect(result.gross.get("raw")?.reduce((sum, qty) => sum + qty, 0)).toBe(40);
    expect(result.gross.get("jug")?.reduce((sum, qty) => sum + qty, 0)).toBe(4);
    const rawOrder = result.planned.find((row) => row.itemId === "raw");
    expect(rawOrder?.kind).toBe("PURCHASE");
    expect(rawOrder?.qty).toBe(orderQty(50, 25, 5));
    expect(rawOrder?.exception).toBe("LATE");
    const jugOrder = result.planned.find((row) => row.itemId === "jug");
    expect(jugOrder?.qty).toBe(4);
    expect(result.planned.find((row) => row.itemId === "blend")?.kind).toBe("PRODUCTION");
  });

  it("counts an open purchase order and asks to cancel surplus", () => {
    const items = [item({ id: "raw", kind: "RAW", make: false, onHandReleased: 100, reorderPoint: 10 })];
    const result = runMrp({
      asOf,
      items,
      bom: [],
      independent: [],
      openSupply: [{ itemId: "raw", date: "2026-11-20", qty: 50 }],
    });
    expect(result.planned).toHaveLength(0);
    expect(result.exceptions.find((row) => row.kind === "CANCEL")?.qty).toBe(140);
  });

  it("lets a manual forecast replace sales history for that week and channel", () => {
    const demand = independentDemand({
      asOf,
      orders: [{ itemId: "fg", date: "2026-11-10", qty: 3, channel: "A", source: "ORDER" }],
      history: [{ itemId: "fg", date: "2026-11-01", qty: 12, channel: "S" }],
      manual: [{ itemId: "fg", date: asOf, qty: 9, channel: "S", source: "FORECAST" }],
    });
    const manualWeek = demand.filter((row) => row.source === "FORECAST" && row.channel === "S");
    const historyWeek0 = demand.filter((row) => row.source === "HISTORY" && row.date === asOf);
    expect(manualWeek.map((row) => row.qty)).toEqual([9]);
    expect(historyWeek0).toHaveLength(0);
    expect(demand.find((row) => row.source === "ORDER")?.date).toBe(asOf);
    expect(demand.filter((row) => row.source === "HISTORY").length).toBe(11);
  });
});

describe("coverage and alerts", () => {
  it("marks critical, low, and ok, and says when a purchase order is open", () => {
    const critical = coverItem({
      onHand: 0, reorderPoint: 10, safetyQty: 0, leadTimeDays: 14, weeklyUsage: 7,
      demandByWeek: [7, 7, 7, 7], suggestedQty: 20, openPoQty: 0, unit: "lb",
    });
    expect(critical.status).toBe("CRITICAL");
    expect(critical.daysVsUsage).toBe(0);
    expect(critical.action).toMatch(/No purchase order/);
    const low = coverItem({
      onHand: 20, reorderPoint: 30, safetyQty: 5, leadTimeDays: 14, weeklyUsage: 7,
      demandByWeek: [7, 7, 7, 7], suggestedQty: 10, openPoQty: 40, unit: "lb",
    });
    expect(low.status).toBe("LOW");
    expect(low.action).toMatch(/already open/);
    const ok = coverItem({
      onHand: 100, reorderPoint: 10, safetyQty: 5, leadTimeDays: 7, weeklyUsage: 7,
      demandByWeek: [7, 7, 7, 7], suggestedQty: 0, openPoQty: 0, unit: "lb",
    });
    expect(ok.status).toBe("OK");
    expect(ok.weeksVsDemand[4]).toBeGreaterThan(4);
    const noisy = coverItem({
      onHand: 0, reorderPoint: 0, safetyQty: 0, leadTimeDays: 0, weeklyUsage: 1,
      demandByWeek: [1], suggestedQty: 0.9996000000000002, openPoQty: 28.773600000000002, unit: "lb",
    });
    expect(noisy.action).toBe("A purchase order is already open for 28.7736 lb. The plan still wants 0.9996 lb more.");
    expect(noisy.action).not.toMatch(/000000/);
  });

  it("sends one alert per status change and one digest per day", () => {
    const item = {
      id: "soda", sku: "SODA", name: "Soda ash", status: "LOW" as const, onHand: 4, unit: "lb",
      daysCover: 3, openPoQty: 0, suggestedQty: 20, recipients: ["marlon@novachem.hn"],
    };
    const first = stockAlerts({ asOf, digest: false, lastDigestOn: null, items: [item], previous: [] });
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].text).toMatch(/SODA/);
    const again = stockAlerts({
      asOf, digest: false, lastDigestOn: null, items: [item],
      previous: [{ itemId: "soda", status: "LOW", emailedOn: asOf }],
    });
    expect(again.messages).toHaveLength(0);
    const worse = stockAlerts({
      asOf, digest: false, lastDigestOn: null, items: [{ ...item, status: "CRITICAL" }],
      previous: [{ itemId: "soda", status: "LOW", emailedOn: asOf }],
    });
    expect(worse.messages).toHaveLength(1);
    const digest = stockAlerts({ asOf, digest: true, lastDigestOn: null, items: [item], previous: [] });
    expect(digest.messages).toHaveLength(1);
    expect(stockAlerts({ asOf, digest: true, lastDigestOn: asOf, items: [item], previous: [] }).messages).toHaveLength(0);
  });

  it("stays unconfigured until a sender and a provider are present", () => {
    expect(emailSetup({}).configured).toBe(false);
    expect(emailSetup({ SPIKE_EMAIL_FROM: "spike@sperchemical.com", SPIKE_EMAIL_PROVIDER: "resend" }).missing).toContain("RESEND_API_KEY");
    expect(emailSetup({
      SPIKE_EMAIL_FROM: "spike@sperchemical.com",
      SPIKE_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "key",
    }).configured).toBe(true);
  });
});
