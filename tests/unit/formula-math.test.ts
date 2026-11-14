import { describe, expect, it } from "vitest";
import {
  PACKAGE_PRESETS,
  contentsWeightLb,
  formulaFromPounds,
  packagedCost,
  qtyPerUnit,
  scaleToPounds,
} from "@/lib/formula-math";
import { rollUpCost } from "@/lib/costing";

describe("pounds to weight percent", () => {
  it("turns a batch of pounds into a formula that sums to 100", () => {
    const result = formulaFromPounds([
      { key: "poly", pounds: 70 },
      { key: "zinc", pounds: 10 },
      { key: "water", pounds: 20 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalLb).toBe(100);
    expect(result.lines.map((line) => line.percent)).toEqual([70, 10, 20]);
    expect(result.lines.reduce((sum, line) => sum + line.percent, 0)).toBeCloseTo(100, 6);
  });

  it("scales that formula to a package weight", () => {
    const formula = formulaFromPounds([
      { key: "a", pounds: 35 },
      { key: "b", pounds: 15 },
      { key: "c", pounds: 50 },
    ]);
    expect(formula.ok).toBe(true);
    if (!formula.ok) return;
    const scaled = scaleToPounds(formula.lines, 10);
    expect(scaled.map((line) => line.pounds)).toEqual([3.5, 1.5, 5]);
  });

  it("rejects a zero-pound ingredient", () => {
    const result = formulaFromPounds([
      { key: "a", pounds: 10 },
      { key: "b", pounds: 0 },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("liquid and powder package weight", () => {
  it("uses specific gravity for liquids and net weight for powders", () => {
    expect(contentsWeightLb({ form: "LIQUID", gallons: 1, specificGravity: 1.2 })).toBeCloseTo(1.2 * 8.34, 4);
    expect(contentsWeightLb({ form: "LIQUID", gallons: 1, specificGravity: null })).toBeNull();
    expect(contentsWeightLb({ form: "POWDER", netLb: 50 })).toBe(50);
    const bag = PACKAGE_PRESETS.find((preset) => preset.code === "PWD-25KG");
    expect(bag?.netLb).toBeCloseTo(55.1156, 3);
    expect(PACKAGE_PRESETS.filter((preset) => preset.form === "LIQUID").map((preset) => preset.gallons)).toEqual([
      0.5, 1, 2.5, 35, 55, 255, 265,
    ]);
  });
});

describe("packaged cost", () => {
  const packaging = [
    { name: "1 gal jug", basis: "UNIT" as const, qty: 1, unitCost: 0.85 },
    { name: "Cap", basis: "UNIT" as const, qty: 1, unitCost: 0.12 },
    { name: "Label", basis: "UNIT" as const, qty: 2, unitCost: 0.08 },
    { name: "4-pack carton", basis: "CASE" as const, qty: 1, unitCost: 0.8 },
    { name: "Divider", basis: "CASE" as const, qty: 1, unitCost: 0.2 },
    { name: "Tape", basis: "CASE" as const, qty: 1, unitCost: 0.15 },
    { name: "Pallet", basis: "PALLET" as const, qty: 1, unitCost: 12 },
    { name: "Stretch wrap", basis: "PALLET" as const, qty: 1, unitCost: 3 },
    { name: "Corner board", basis: "PALLET" as const, qty: 4, unitCost: 0.35 },
  ];

  it("splits case and pallet materials back to one unit and keeps every basis", () => {
    expect(qtyPerUnit({ basis: "CASE", qty: 1, unitsPerCase: 4, casesPerPallet: 48 })).toBe(0.25);
    expect(qtyPerUnit({ basis: "PALLET", qty: 1, unitsPerCase: 4, casesPerPallet: 48 })).toBeCloseTo(1 / 192, 8);
    const contentsLb = 1.2 * 8.34;
    const result = packagedCost({
      contentsCostPerLb: 0.404,
      contentsLb,
      gallons: 1,
      unitsPerCase: 4,
      casesPerPallet: 48,
      laborPerUnit: 0.35,
      packaging,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const packagingEach =
      0.85 + 0.12 + 0.16 + 0.8 / 4 + 0.2 / 4 + 0.15 / 4 + (12 + 3 + 1.4) / 192;
    expect(result.cost.packagingCost).toBeCloseTo(packagingEach, 4);
    expect(result.cost.perUnit).toBeCloseTo(contentsLb * 0.404 + packagingEach + 0.35, 4);
    expect(result.cost.perCase).toBeCloseTo(result.cost.perUnit * 4, 4);
    expect(result.cost.perPallet).toBeCloseTo(result.cost.perUnit * 192, 3);
    expect(result.cost.perLb).toBeCloseTo(result.cost.perUnit / contentsLb, 4);
    expect(result.cost.perKg).toBeCloseTo(result.cost.perLb * 2.2046226218, 4);
    expect(result.cost.perGal).toBeCloseTo(result.cost.perUnit, 4);
  });

  it("refuses a partial total when a packaging item or the formula has no cost", () => {
    const missingPack = packagedCost({
      contentsCostPerLb: 0.404,
      contentsLb: 10,
      gallons: 1,
      unitsPerCase: 4,
      casesPerPallet: 12,
      laborPerUnit: 0,
      packaging: [{ name: "Jug", basis: "UNIT", qty: 1, unitCost: null }],
    });
    expect(missingPack.ok).toBe(false);
    if (!missingPack.ok) expect(missingPack.error).toMatch(/Jug/);
    const missingFormula = packagedCost({
      contentsCostPerLb: null,
      contentsLb: 10,
      gallons: 1,
      unitsPerCase: 4,
      casesPerPallet: 12,
      laborPerUnit: 0,
      packaging: [],
    });
    expect(missingFormula.ok).toBe(false);
    if (!missingFormula.ok) expect("perUnit" in missingFormula).toBe(false);
  });

  it("still rolls a sub-recipe before the package cost is trusted", () => {
    const products = [
      { id: "raw", sku: "A", name: "Acid", kind: "RAW" as const, standardCost: 0.5 },
      { id: "child", sku: "C", name: "Blend", kind: "FINISHED" as const, standardCost: 9 },
      { id: "parent", sku: "P", name: "Parent", kind: "FINISHED" as const, standardCost: 9 },
    ];
    const incomplete = rollUpCost("parent", products, [
      { productId: "child", isDefault: true, lines: [{ ingredientId: "missing", percent: 100 }] },
      { productId: "parent", isDefault: true, lines: [{ ingredientId: "child", percent: 100 }] },
    ]);
    expect(incomplete.costPerUnit).toBeNull();
    const complete = rollUpCost("parent", products, [
      { productId: "child", isDefault: true, lines: [{ ingredientId: "raw", percent: 100 }] },
      { productId: "parent", isDefault: true, lines: [{ ingredientId: "child", percent: 100 }] },
    ]);
    expect(complete.costPerUnit).toBeCloseTo(0.5, 6);
  });
});
