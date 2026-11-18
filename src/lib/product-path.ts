export type ProductPathName = "RESALE" | "REPACK" | "MANUFACTURED";

export const PRODUCT_PATHS: { code: ProductPathName; label: string }[] = [
  { code: "RESALE", label: "Resale — buy it and sell it as-is" },
  { code: "REPACK", label: "Repack — same product, a SPER package" },
  { code: "MANUFACTURED", label: "Manufactured — we make it from a formula" },
];

export function pathSteps(path: ProductPathName): { title: string; detail: string }[] {
  const buy = { title: "Buy", detail: "Purchase the material from a supplier." };
  if (path === "RESALE") {
    return [buy, { title: "Sell as-is", detail: "Sell the same item. There is no formula and no new package." }];
  }
  if (path === "REPACK") {
    return [
      buy,
      { title: "Repack", detail: "Put it into a SPER presentation. The formula does not change." },
      { title: "Sell", detail: "Each presentation is its own SKU with its own packaging cost." },
    ];
  }
  return [
    buy,
    { title: "Make", detail: "Use the formula and the bill of materials." },
    { title: "Pack", detail: "Fill each presentation. Each one is its own SKU with its own packaging cost." },
    { title: "Sell", detail: "Sell the presentation." },
  ];
}

export function pathShowsFormula(path: ProductPathName): boolean {
  return path === "MANUFACTURED";
}
