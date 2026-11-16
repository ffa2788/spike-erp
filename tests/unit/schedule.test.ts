import { describe, expect, it } from "vitest";
import { nextWeekdays, roundUpToMultiple, suggestSchedule, type ScheduleSku } from "@/lib/schedule";
import { parseFbaPosition } from "@/lib/amazon-sp";

function sku(partial: Partial<ScheduleSku> & Pick<ScheduleSku, "id">): ScheduleSku {
  return {
    sku: partial.id,
    name: partial.id,
    packageLabel: "1 gal",
    unit: "each",
    multiple: 4,
    coverDays: 14,
    salesQty: 0,
    windowDays: 56,
    salesByChannel: { S: 0, A: 0, W: 0, E: 0 },
    openOrders: 0,
    amazonOpenOrders: 0,
    supermarket: 0,
    fbaFulfillable: 0,
    fbaInbound: 0,
    wip: 0,
    formulaVersion: 1,
    pullLot: "L-1001",
    materials: [],
    ...partial,
  };
}

describe("suggested production schedule", () => {
  it("covers 14 days of sales plus open orders, and rounds up to the case", () => {
    const [row] = suggestSchedule({
      asOf: "2026-11-14",
      skus: [
        sku({
          id: "jug",
          salesQty: 560,
          salesByChannel: { S: 280, A: 140, W: 140, E: 0 },
          openOrders: 20,
          amazonOpenOrders: 8,
          supermarket: 40,
          fbaFulfillable: 10,
          fbaInbound: 5,
          wip: 5,
          materials: [{ id: "jug-item", name: "1 gal jug", requiredPerUnit: 1, onHand: 12, unit: "each" }],
        }),
      ],
    });
    expect(row.daily).toBe(10);
    expect(row.target).toBe(140);
    expect(row.supply).toBe(60);
    expect(row.suggested).toBe(100);
    expect(row.fbaReplenish).toBe(28);
    expect(row.fbaNote).toMatch(/supermarket to FBA/);
    expect(row.daysCover).toBe(6);
    expect(row.shortage).toBe(true);
    expect(row.materials[0].short).toBe(88);
    expect(row.dueOn).toBe("2026-11-16");
    expect(roundUpToMultiple(10, 4)).toBe(12);
    expect(roundUpToMultiple(0, 4)).toBe(0);
  });

  it("does not call a supermarket shipment a new batch, and orders the shortest cover first", () => {
    const rows = suggestSchedule({
      asOf: "2026-11-14",
      skus: [
        sku({ id: "full", salesQty: 56, supermarket: 1000, multiple: 1, coverDays: 14 }),
        sku({ id: "empty", salesQty: 0, openOrders: 3, supermarket: 0, multiple: 1, coverDays: 14, fbaFulfillable: 0, amazonOpenOrders: 2, salesByChannel: { S: 0, A: 0, W: 0, E: 0 } }),
      ],
    });
    expect(rows[0].id).toBe("empty");
    expect(rows[0].suggested).toBe(3);
    expect(rows[0].fbaNote).toMatch(/supermarket is empty/);
    expect(rows[0].fbaReplenish).toBe(0);
    expect(rows[1].suggested).toBe(0);
    expect(nextWeekdays("2026-11-14")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  });

  it("reads fulfillable and inbound FBA columns and does not invent rows", () => {
    const rows = parseFbaPosition("seller-sku\tafn-fulfillable-quantity\tafn-inbound-shipped-quantity\nPOLY-LIQ-1G\t6\t4\n");
    expect(rows).toEqual([{ sku: "POLY-LIQ-1G", fulfillable: 6, inbound: 4 }]);
    expect(parseFbaPosition("")).toEqual([]);
  });
});
