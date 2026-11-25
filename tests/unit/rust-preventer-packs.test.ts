import { describe, expect, it } from "vitest";
import { invoiceQty } from "@/lib/amazon-reports";
import { halfGallonPackPlan } from "@/lib/rust-preventer-packs";

describe("Rust Preventer packs", () => {
  it("does not invent a jug SKU or a jug cost", () => {
    const plan = halfGallonPackPlan();
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.missing).toEqual(["jug SKU", "jug cost", "2-pack SKU", "4-pack SKU"]);
  });

  it("builds a 2-pack and a 4-pack of RUST-PREVENTER-1 once the jug is named", () => {
    const plan = halfGallonPackPlan({
      jugSku: "JUG-HALF",
      jugCostDollars: 0.4,
      twoPackSku: "RP-HALF-2",
      fourPackSku: "RP-HALF-4",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.bulkSku).toBe("RUST-PREVENTER-1");
    expect(plan.packs.map((pack) => [pack.sku, pack.jugs, pack.gallonsEach, pack.jugCostDollars])).toEqual([
      ["RP-HALF-2", 2, 0.5, 0.4],
      ["RP-HALF-4", 4, 0.5, 0.4],
    ]);
  });

  it("counts SC-PR1-1-2PK as two of the 1 gal", () => {
    expect(invoiceQty(1, 2)).toBe(2);
    expect(invoiceQty(3, 1)).toBe(3);
  });
});