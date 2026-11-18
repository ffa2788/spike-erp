import { describe, expect, it } from "vitest";
import { buySoon, packagingQty, roundBuy } from "@/lib/buy-soon";

describe("consumption cover", () => {
  it("divides eight weeks of use and flags a cap that runs out before the truck can arrive", () => {
    const caps = buySoon({
      onHand: 40,
      onOrder: 0,
      usedIn8Weeks: 320,
      weeklyOverride: null,
      leadTimeWeeks: 3,
      safetyWeeks: 2,
      moq: 24,
      multiple: 12,
      asOf: "2026-10-31",
    });
    expect(caps.weeklyUse).toBe(40);
    expect(caps.weeksLeft).toBe(1);
    expect(caps.reorderPoint).toBe(200);
    expect(caps.tone).toBe("red");
    expect(caps.runOut).toBe("2026-11-07");
    expect(caps.suggestedQty).toBe(168);
  });

  it("uses the override and marks amber when there is time to order this week", () => {
    const wrap = buySoon({
      onHand: 5,
      onOrder: 0,
      usedIn8Weeks: 0,
      weeklyOverride: 2,
      leadTimeWeeks: 1,
      safetyWeeks: 2,
      moq: 0,
      multiple: 1,
      asOf: "2026-10-31",
    });
    expect(wrap.weeklyUse).toBe(2);
    expect(wrap.weeksLeft).toBe(2.5);
    expect(wrap.tone).toBe("amber");
    expect(wrap.suggestedQty).toBe(1);
  });

  it("stays quiet when cover is past the lead time and the safety weeks", () => {
    const bottles = buySoon({
      onHand: 1680,
      onOrder: 0,
      usedIn8Weeks: 320,
      weeklyOverride: null,
      leadTimeWeeks: 1,
      safetyWeeks: 2,
      moq: 48,
      multiple: 1,
      asOf: "2026-10-31",
    });
    expect(bottles.tone).toBe("ok");
    expect(bottles.suggestedQty).toBe(0);
  });

  it("explodes a pallet shipment into the bottle, the cap, the label, the pallet, and the wrap", () => {
    const units = 96;
    expect(packagingQty({ units, unitsPerCase: 4, casesPerPallet: 12, basis: "UNIT", qty: 1 })).toBe(96);
    expect(packagingQty({ units, unitsPerCase: 4, casesPerPallet: 12, basis: "CASE", qty: 1 })).toBe(24);
    expect(packagingQty({ units, unitsPerCase: 4, casesPerPallet: 12, basis: "PALLET", qty: 1 })).toBe(2);
    expect(roundBuy(10, 24, 12)).toBe(24);
  });
});
